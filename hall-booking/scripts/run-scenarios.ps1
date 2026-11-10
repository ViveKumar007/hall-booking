<#
  Runs the automated test scenarios through the Camunda 8 REST API (same effect as using Tasklist),
  checks each booking's outcome and approval chain, and prints PASS/FAIL. Takes about 3 minutes, because
  scenario C waits for the 1-minute reminder and the 2-minute expiry.

  Needs: Camunda (start-camunda.cmd), the mail server (start-mail.cmd) and the Spring Boot backend
  (start-backend.cmd: booking register + job workers). Every scenario must also end with its email delivered to the
  mail server's inbox.

  Usage:
    scripts\reset-data.cmd
    powershell -ExecutionPolicy Bypass -File scripts\run-scenarios.ps1
    powershell -ExecutionPolicy Bypass -File scripts\run-scenarios.ps1 -SkipTimer   # skip C and R (about 40 s)

  The service-down, timeout and worker-down tests need windows closed and reopened, so they are manual:
  see "Test cases" in PROJECT-GUIDE.md.
#>
param(
  [string]$Camunda = 'http://localhost:8080',
  [string]$Register = 'http://127.0.0.1:8090/register',
  [string]$Mail = 'http://127.0.0.1:1080',
  [string]$RegisterKey = $env:REGISTER_API_KEY,
  [switch]$SkipTimer
)
$ErrorActionPreference = 'Stop'

# The booking register only answers callers with its shared key (as the REST connectors send it), from secrets.cmd.
if (-not $RegisterKey) {
  $line = Get-Content (Join-Path $PSScriptRoot 'secrets.cmd') -ErrorAction SilentlyContinue | Where-Object { $_ -match '^set "REGISTER_API_KEY=(.*)"$' } | Select-Object -First 1
  if ($line -match '^set "REGISTER_API_KEY=(.*)"$') { $RegisterKey = $Matches[1] }
}
$RegisterHeaders = @{ 'X-Register-Key' = $RegisterKey }

# A run sends about 75 emails (to example.com test addresses and to the approver accounts). Only into MailDev.
$smtpLine = Get-Content (Join-Path $PSScriptRoot 'secrets.cmd') -ErrorAction SilentlyContinue | Where-Object { $_ -match '^set "SMTP_HOST=(.*)"$' } | Select-Object -Last 1
if ($smtpLine -match '^set "SMTP_HOST=(.*)"$' -and $Matches[1] -notin '127.0.0.1', 'localhost') {
  throw "Real mail is on (SMTP_HOST=$($Matches[1]) in secrets.cmd). Switch back to MailDev and restart Camunda before running the scenarios."
}

function Invoke-Api([string]$Method, [string]$Path, $Body) {
  $params = @{ Method = $Method; Uri = "$Camunda$Path"; ContentType = 'application/json' }
  if ($null -ne $Body) { $params.Body = ($Body | ConvertTo-Json -Depth 10 -Compress) }
  Invoke-RestMethod @params
}

# Process-level variable of an instance (not the local ones inside multi-instance or sub-process scopes).
# Values come back as JSON text, e.g. "\"APPROVED\"". Returns the raw text, or $null.
function Get-RawVariable([string]$Pik, [string]$Name) {
  $r = Invoke-Api POST '/v2/variables/search' @{ filter = @{ processInstanceKey = $Pik; scopeKey = $Pik; name = $Name } }
  if ($r.items.Count -eq 0) { return $null }
  $r.items[0].value
}
function Get-ProcessVariable([string]$Pik, [string]$Name) {
  $raw = Get-RawVariable $Pik $Name
  if ($null -eq $raw) { return $null }
  $raw | ConvertFrom-Json
}

function Start-Booking($s) {
  $sessions = if ($s.Sessions) { $s.Sessions } else { @(@{ venue = $s.Venue; bookingDate = $s.Date; startTime = $s.From; endTime = $s.To }) }
  # Short review times, so the reminder and expiry case (C) finishes within the run. The app's default is 1 day.
  $vars = @{
    requesterName = "Scenario $($s.Id)"; email = "scenario.$($s.Id.ToLower())@example.com"; purpose = $s.Desc
    attendees = $s.People; sessions = @($sessions)
    approvalTimes = @{ timeout = 'PT2M'; reminder = 'PT1M'; timeoutText = '2 minutes'; reminderText = '1 minute'; leftText = '1 minute' }
  }
  (Invoke-Api POST '/v2/process-instances' @{ processDefinitionId = 'hall-booking'; variables = $vars }).processInstanceKey
}

# Child instances of a booking: one Hall Approval per approver in the chain (Call Activity). The booking's Send email
# children (request received, service issue) are left out.
function Get-Children([string]$Pik) {
  @((Invoke-Api POST '/v2/process-instances/search' @{ filter = @{ parentProcessInstanceKey = $Pik; processDefinitionId = 'hall-approval' } }).items)
}

# The open Review booking task of a booking, in whichever child instance is waiting.
# $Done holds task keys already completed (search results can lag a second behind).
function Find-ApprovalTask([string]$Pik, [hashtable]$Done = @{}, [int]$TimeoutSec = 60) {
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  while ((Get-Date) -lt $deadline) {
    foreach ($c in (Get-Children $Pik)) {
      if ($c.state -ne 'ACTIVE') { continue }
      $tasks = (Invoke-Api POST '/v2/user-tasks/search' @{ filter = @{ processInstanceKey = $c.processInstanceKey; elementId = 'User_Approval'; state = 'CREATED' } }).items
      foreach ($t in $tasks) { if (-not $Done.ContainsKey([string]$t.userTaskKey)) { return $t } }
    }
    Start-Sleep -Seconds 1
  }
  throw "No approval task appeared for booking instance $Pik"
}

function Wait-Finished([string]$Pik, [int]$TimeoutSec = 60) {
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  while ((Get-Date) -lt $deadline) {
    $pi = $null
    try { $pi = Invoke-Api GET "/v2/process-instances/$Pik" $null } catch { }
    if ($pi) {
      if ($pi.hasIncident) { return 'INCIDENT' }
      if ($pi.state -ne 'ACTIVE') { return $pi.state }
    }
    Start-Sleep -Seconds 1
  }
  return 'TIMEOUT'
}

function Complete-Approval($Task, [bool]$Approve, [string]$Remarks) {
  Invoke-Api POST "/v2/user-tasks/$($Task.userTaskKey)/completion" @{ variables = @{ approved = $Approve; remarks = $Remarks } } | Out-Null
}

# Action: approve / reject = one approver decides; chain = several approvers decide in turn (Decisions);
# none = no approval task expected; wait = nobody acts (timer case); hold = leave pending (used by Q1).
# Approver: the expected approval chain, comma separated. Children / Held: optional extra checks.
$all = @(
  # Main paths
  @{ Id='A';  Group='Main path';         Desc='free slot, approved';                Venue='hall-a'; Date='2027-01-12'; From='14:00'; To='16:00'; People=50;  Action='approve'; Outcome='APPROVED';      Approver='admin-office' },
  @{ Id='B';  Group='Main path';         Desc='overlaps seed booking 10-12';        Venue='hall-a'; Date='2027-01-11'; From='11:00'; To='13:00'; People=40;  Action='none';    Outcome='CONFLICT';      Approver=$null },
  @{ Id='C';  Group='Main path';         Desc='nobody acts: reminder, then expiry'; Venue='lab-1';  Date='2027-01-13'; From='10:00'; To='12:00'; People=30;  Action='wait';    Outcome='EXPIRED';       Approver='lab-incharge' },
  @{ Id='D';  Group='Main path';         Desc='end time before start time';         Venue='hall-b'; Date='2027-01-14'; From='15:00'; To='13:00'; People=20;  Action='none';    Outcome='INVALID_TIME';  Approver=$null },
  @{ Id='E';  Group='Main path';         Desc='6 hours, approved';                  Venue='hall-b'; Date='2027-01-15'; From='09:00'; To='15:00'; People=80;  Action='approve'; Outcome='APPROVED';      Approver='dean' },
  @{ Id='F';  Group='Main path';         Desc='150 people, rejected';               Venue='hall-b'; Date='2027-01-18'; From='10:00'; To='12:00'; People=150; Action='reject';  Outcome='REJECTED';      Approver='hod' },
  # Validation by the external worker (BPMN error INVALID_REQUEST)
  @{ Id='G';  Group='Worker validation'; Desc='date in the past';                   Venue='hall-a'; Date='2026-10-01'; From='10:00'; To='12:00'; People=30;  Action='none';    Outcome='PAST_DATE';     Approver=$null },
  @{ Id='H';  Group='Worker validation'; Desc='61 people in a 60-seat lab';         Venue='lab-1';  Date='2027-01-19'; From='10:00'; To='12:00'; People=61;  Action='none';    Outcome='OVER_CAPACITY'; Approver=$null },
  @{ Id='I';  Group='Worker validation'; Desc='exactly 60 people in the lab';       Venue='lab-1';  Date='2027-01-19'; From='13:00'; To='15:00'; People=60;  Action='approve'; Outcome='APPROVED';      Approver='lab-incharge' },
  @{ Id='J';  Group='Worker validation'; Desc='zero-length booking 10:00-10:00';    Venue='hall-a'; Date='2027-01-20'; From='10:00'; To='10:00'; People=30;  Action='none';    Outcome='INVALID_TIME';  Approver=$null },
  # Conflict check edges
  @{ Id='K';  Group='Conflict check';    Desc='back-to-back with seed 10-12';       Venue='hall-a'; Date='2027-01-11'; From='12:00'; To='14:00'; People=40;  Action='approve'; Outcome='APPROVED';      Approver='admin-office' },
  @{ Id='L';  Group='Conflict check';    Desc='same time, other venue';             Venue='hall-b'; Date='2027-01-11'; From='10:00'; To='12:00'; People=40;  Action='approve'; Outcome='APPROVED';      Approver='admin-office' },
  @{ Id='M';  Group='Conflict check';    Desc='covers the whole seed booking';      Venue='hall-a'; Date='2027-01-11'; From='09:00'; To='13:00'; People=40;  Action='none';    Outcome='CONFLICT';      Approver=$null },
  # DMN rule edges
  @{ Id='N';  Group='DMN rules';         Desc='exactly 4 h and 100 people';         Venue='hall-a'; Date='2027-01-21'; From='09:00'; To='13:00'; People=100; Action='approve'; Outcome='APPROVED';      Approver='admin-office' },
  @{ Id='O';  Group='DMN rules';         Desc='101 people';                         Venue='hall-a'; Date='2027-01-21'; From='14:00'; To='16:00'; People=101; Action='approve'; Outcome='APPROVED';      Approver='hod' },
  @{ Id='P';  Group='DMN rules';         Desc='8 h and 150 people: FIRST picks dean'; Venue='hall-b'; Date='2027-01-22'; From='08:00'; To='16:00'; People=150; Action='approve'; Outcome='APPROVED';    Approver='dean' },
  # Holding the slot
  @{ Id='Q1'; Group='Slot hold';         Desc='left pending while Q2 runs';         Venue='hall-a'; Date='2027-01-25'; From='10:00'; To='12:00'; People=40;  Action='hold';    Outcome='APPROVED';      Approver='admin-office' },
  @{ Id='Q2'; Group='Slot hold';         Desc='same slot while Q1 is pending';      Venue='hall-a'; Date='2027-01-25'; From='10:00'; To='12:00'; People=40;  Action='none';    Outcome='CONFLICT';      Approver=$null },
  @{ Id='R';  Group='Slot hold';         Desc='rebook the slot C let expire';       Venue='lab-1';  Date='2027-01-13'; From='10:00'; To='12:00'; People=30;  Action='approve'; Outcome='APPROVED';      Approver='lab-incharge' },
  # Several sessions: parallel multi-instance checks and holds, sequential approval chain (Call Activity)
  @{ Id='MS1'; Group='Multi-session'; Desc='hall + lab: two approvers, both approve'; People=40; Action='chain'; Decisions=@('approve','approve'); Outcome='APPROVED'; Approver='admin-office,lab-incharge'; Children=2; Held=2
     Sessions=@(@{ venue='hall-a'; bookingDate='2027-01-26'; startTime='10:00'; endTime='12:00' }, @{ venue='lab-1'; bookingDate='2027-01-26'; startTime='14:00'; endTime='16:00' }) },
  @{ Id='MS2'; Group='Multi-session'; Desc='dean approves, admin office rejects'; People=40; Action='chain'; Decisions=@('approve','reject'); Outcome='REJECTED'; Approver='dean,admin-office'; Children=2; Held=2
     Sessions=@(@{ venue='hall-b'; bookingDate='2027-01-27'; startTime='09:00'; endTime='15:00' }, @{ venue='hall-a'; bookingDate='2027-01-27'; startTime='10:00'; endTime='12:00' }) },
  @{ Id='MS3'; Group='Multi-session'; Desc='first approver rejects: chain stops'; People=40; Action='chain'; Decisions=@('reject'); Outcome='REJECTED'; Approver='dean,lab-incharge'; Children=1; Held=2
     Sessions=@(@{ venue='hall-b'; bookingDate='2027-01-28'; startTime='09:00'; endTime='15:00' }, @{ venue='lab-1'; bookingDate='2027-01-28'; startTime='10:00'; endTime='12:00' }) },
  @{ Id='MS4'; Group='Multi-session'; Desc='second session clashes with seed'; People=40; Action='none'; Outcome='CONFLICT'; Approver=$null; Children=0
     Sessions=@(@{ venue='lab-1'; bookingDate='2027-01-29'; startTime='10:00'; endTime='12:00' }, @{ venue='hall-a'; bookingDate='2027-01-11'; startTime='11:00'; endTime='13:00' }) },
  @{ Id='MS5'; Group='Multi-session'; Desc='two sessions overlap each other'; People=40; Action='none'; Outcome='INVALID_TIME'; Approver=$null; Children=0
     Sessions=@(@{ venue='hall-a'; bookingDate='2027-01-29'; startTime='10:00'; endTime='12:00' }, @{ venue='hall-a'; bookingDate='2027-01-29'; startTime='11:00'; endTime='13:00' }) },
  @{ Id='MS6'; Group='Multi-session'; Desc='same venue, two days: one approver'; People=40; Action='chain'; Decisions=@('approve'); Outcome='APPROVED'; Approver='admin-office'; Children=1; Held=2
     Sessions=@(@{ venue='hall-a'; bookingDate='2027-02-01'; startTime='10:00'; endTime='12:00' }, @{ venue='hall-a'; bookingDate='2027-02-02'; startTime='10:00'; endTime='12:00' }) }
)
$byId = @{}; foreach ($s in $all) { $byId[$s.Id] = $s }

try { $seed = @((Invoke-RestMethod "$Register/bookings" -Headers $RegisterHeaders) | ForEach-Object { $_ }) } catch { throw "Booking register not reachable at $Register with the key from secrets.cmd ($($_.Exception.Message)). Run scripts\start-backend.cmd first." }
if ($seed.Count -ne 3) { Write-Warning "The register has $($seed.Count) bookings, not the 3 seed ones. Run scripts\reset-data.cmd for clean results." }

$pik = @{}
$notes = @{}

# C first: its timers run while everything else is tested.
if (-not $SkipTimer) {
  $pik['C'] = Start-Booking $byId['C']
  $cTask = Find-ApprovalTask $pik['C']
  $cApproval = $cTask.processInstanceKey
  Write-Host "[C  ] started $($pik['C']); approval waits in Hall Approval instance $cApproval (nobody will act)"
}

foreach ($id in 'A','B','D','E','F','G','H','I','J','K','L','M','N','O','P','MS1','MS2','MS3','MS4','MS5','MS6') {
  $s = $byId[$id]
  $pik[$id] = Start-Booking $s
  $decisions = if ($s.Action -eq 'chain') { $s.Decisions } elseif ($s.Action -in 'approve','reject') { @($s.Action) } else { @() }
  $done = @{}
  foreach ($d in $decisions) {
    $task = Find-ApprovalTask $pik[$id] $done
    $done[[string]$task.userTaskKey] = $true
    Complete-Approval $task ($d -eq 'approve') "Completed by run-scenarios ($id)"
  }
  $null = Wait-Finished $pik[$id]
  Write-Host ("[{0,-3}] {1}" -f $id, $s.Desc)
}

# Q: hold a slot, try the same slot again, then approve the first one.
$pik['Q1'] = Start-Booking $byId['Q1']
$q1Task = Find-ApprovalTask $pik['Q1']
$pik['Q2'] = Start-Booking $byId['Q2']
$null = Wait-Finished $pik['Q2']
Complete-Approval $q1Task $true 'Completed by run-scenarios (Q1)'
$null = Wait-Finished $pik['Q1']
Write-Host '[Q  ] Q2 tried the slot Q1 was holding; Q1 approved afterwards'

if (-not $SkipTimer) {
  Write-Host '[C  ] waiting for the 1-minute reminder and the 2-minute expiry ...'
  $null = Wait-Finished $pik['C'] 200
  $reminder = (Invoke-Api POST '/v2/element-instances/search' @{ filter = @{ processInstanceKey = $cApproval; elementId = 'Worker_Reminder' } }).items
  $notes['C'] = $(if ($reminder.Count -gt 0 -and $reminder[0].state -eq 'COMPLETED') { 'reminder sent' } else { 'NO reminder' })
  $pik['R'] = Start-Booking $byId['R']
  Complete-Approval (Find-ApprovalTask $pik['R']) $true 'Completed by run-scenarios (R)'
  $null = Wait-Finished $pik['R']
  Write-Host '[R  ] rebooked the slot C released'
}

# Emails delivered by the Email connector, as the mail server's inbox lists them.
$inbox = $null
try { $inbox = @((Invoke-RestMethod "$Mail/api/email") | ForEach-Object { $_ }) }
catch { Write-Warning "Mail inbox not reachable at $Mail (run scripts\start-mail.cmd); inbox checks are skipped." }

$results = foreach ($s in $all) {
  if (-not $pik.ContainsKey($s.Id)) { continue }
  $p = $pik[$s.Id]
  $state = Wait-Finished $p 30
  $outcome = Get-ProcessVariable $p 'outcome'
  $chain = Get-ProcessVariable $p 'approvers'
  $approver = if ($null -eq $chain) { $null } else { @($chain) -join ',' }
  $ok = $state -eq 'COMPLETED' -and $outcome -eq $s.Outcome -and $approver -eq $s.Approver
  $why = @()
  if ($s.ContainsKey('Children')) {
    $n = @(Get-Children $p).Count
    if ($n -ne $s.Children) { $ok = $false; $why += "children $n, expected $($s.Children)" } else { $notes[$s.Id] = "$n approval instance(s)" }
  }
  if ($s.ContainsKey('Held')) {
    $held = Get-ProcessVariable $p 'heldSlots'
    $heldCount = if ($null -eq $held) { 0 } else { @($held).Count }
    if ($heldCount -ne $s.Held) { $ok = $false; $why += "held $heldCount, expected $($s.Held)" }
  }
  $emailStatus = Get-ProcessVariable $p 'emailStatus'
  if ($emailStatus -ne 'SENT') { $ok = $false; $why += "email $emailStatus" }
  $addr = "scenario.$($s.Id.ToLower())@example.com"
  if ($null -ne $inbox) {
    $mails = @($inbox | Where-Object { (@($_.to | ForEach-Object { $_.address }) -contains $addr) -and $_.subject -eq "Hall booking $($s.Outcome)" })
    if ($mails.Count -eq 0) { $ok = $false; $why += 'no email in inbox' }
  }
  # Update emails (send-email child process): "received" to the requester once the slots are held, and one to the
  # approver role's accounts for every review.
  if ($s.Approver) {
    $received = Get-ProcessVariable $p 'receivedEmail'
    if ($received.status -ne 'SENT') { $ok = $false; $why += "received email $($received.status)" }
    elseif ($null -ne $inbox -and -not @($inbox | Where-Object { (@($_.to | ForEach-Object { $_.address }) -contains $addr) -and $_.subject -like 'Hall booking request received*' }).Count) {
      $ok = $false; $why += 'no received email in inbox'
    }
    foreach ($c in (Get-Children $p)) {
      $ae = Get-ProcessVariable $c.processInstanceKey 'approverEmail'
      if ($ae.status -ne 'SENT') { $ok = $false; $why += "approver email $($ae.status)"; continue }
      $first = @($ae.to -split ',')[0]
      if ($null -ne $inbox -and -not @($inbox | Where-Object { (@($_.to | ForEach-Object { $_.address }) -contains $first) -and $_.subject -like '*is waiting for your review' }).Count) {
        $ok = $false; $why += "no review email to $first"
      }
    }
  }
  if ($s.Id -eq 'C') {
    if ($notes['C'] -ne 'reminder sent') { $ok = $false }
    $re = Get-ProcessVariable $cApproval 'reminderEmail'
    if ($re.status -ne 'SENT') { $ok = $false; $why += "reminder email $($re.status)" } else { $notes['C'] += ', reminder emailed' }
  }
  [pscustomobject]@{
    Test     = $s.Id
    Group    = $s.Group
    Case     = $s.Desc
    Outcome  = $outcome
    Approver = $approver
    Note     = $notes[$s.Id]
    Result   = $(if ($ok) { 'PASS' } else { "FAIL (expected $($s.Outcome)/$($s.Approver), state $state $($why -join '; '))" })
  }
}
$results | Format-Table -AutoSize -Wrap
$passed = @($results | Where-Object { $_.Result -eq 'PASS' }).Count
Write-Host "$passed of $(@($results).Count) passed"

$bookings = @((Invoke-RestMethod "$Register/bookings" -Headers $RegisterHeaders) | ForEach-Object { $_ })
$sent = @((Invoke-RestMethod "$Register/notifications" -Headers $RegisterHeaders) | ForEach-Object { $_ })
Write-Host "The register now holds $($bookings.Count) bookings and $($sent.Count) notifications."
