<#
  Runs the automated test scenarios through the Camunda 8 REST API (same effect as using Tasklist),
  checks each booking's outcome and approver, and prints PASS/FAIL. Takes about 3 minutes, because
  scenario C waits for the 1-minute reminder and the 2-minute expiry.

  Needs: Camunda (start-camunda.cmd), the mock API (start-mock.cmd) and the worker (start-worker.cmd).

  Usage:
    scripts\reset-mock.cmd
    powershell -ExecutionPolicy Bypass -File scripts\run-scenarios.ps1
    powershell -ExecutionPolicy Bypass -File scripts\run-scenarios.ps1 -SkipTimer   # skip C and R (about 30 s)

  The service-down and worker-down tests need windows closed and reopened, so they are manual:
  see "Test cases" in PROJECT-GUIDE.md.
#>
param(
  [string]$Camunda = 'http://localhost:8080',
  [string]$Mock = 'http://127.0.0.1:3000',
  [switch]$SkipTimer
)
$ErrorActionPreference = 'Stop'

function Invoke-Api([string]$Method, [string]$Path, $Body) {
  $params = @{ Method = $Method; Uri = "$Camunda$Path"; ContentType = 'application/json' }
  if ($null -ne $Body) { $params.Body = ($Body | ConvertTo-Json -Depth 10 -Compress) }
  Invoke-RestMethod @params
}

# Variable values come back as JSON text, e.g. "\"APPROVED\"". Returns the raw text, or $null.
function Get-RawVariable([string]$Pik, [string]$Name) {
  $r = Invoke-Api POST '/v2/variables/search' @{ filter = @{ processInstanceKey = $Pik; name = $Name } }
  if ($r.items.Count -eq 0) { return $null }
  $r.items[0].value
}
function Get-ProcessVariable([string]$Pik, [string]$Name) {
  $raw = Get-RawVariable $Pik $Name
  if ($null -eq $raw) { return $null }
  $raw | ConvertFrom-Json
}

function Start-Booking($s) {
  $vars = @{
    requesterName = "Scenario $($s.Id)"; email = "scenario.$($s.Id.ToLower())@example.com"; purpose = $s.Desc
    venue = $s.Venue; bookingDate = $s.Date; startTime = $s.From; endTime = $s.To; attendees = $s.People
  }
  (Invoke-Api POST '/v2/process-instances' @{ processDefinitionId = 'hall-booking'; variables = $vars }).processInstanceKey
}

# The approval task lives in the Hall Administration pool (its own process instance).
# Match it to the booking through the shared bookingRef, e.g. "BK-7".
function Find-ApprovalTask([string]$Pik, [int]$TimeoutSec = 60) {
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  $ref = $null
  while ((Get-Date) -lt $deadline) {
    if (-not $ref) { $ref = Get-RawVariable $Pik 'bookingRef' }
    if ($ref) {
      $tasks = (Invoke-Api POST '/v2/user-tasks/search' @{ filter = @{ elementId = 'User_Approval'; state = 'CREATED' } }).items
      foreach ($t in $tasks) { if ((Get-RawVariable $t.processInstanceKey 'bookingRef') -eq $ref) { return $t } }
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

# Action: approve / reject = complete the approval task; none = no approval task expected;
# wait = nobody acts (timer case); hold = leave pending (used by Q1).
$all = @(
  # Main paths
  @{ Id='A';  Group='Main path';         Desc='free slot, approved';                Venue='hall-a'; Date='2027-01-12'; From='14:00'; To='16:00'; People=50;  Action='approve'; Outcome='APPROVED';      Approver='admin-office' },
  @{ Id='B';  Group='Main path';         Desc='overlaps seed booking 10-12';        Venue='hall-a'; Date='2027-01-11'; From='11:00'; To='13:00'; People=40;  Action='none';    Outcome='CONFLICT';      Approver=$null },
  @{ Id='C';  Group='Main path';         Desc='nobody acts: reminder, then expiry'; Venue='lab-1';  Date='2027-01-13'; From='10:00'; To='12:00'; People=30;  Action='wait';    Outcome='EXPIRED';       Approver='lab-incharge' },
  @{ Id='D';  Group='Main path';         Desc='end time before start time';         Venue='hall-b'; Date='2027-01-14'; From='15:00'; To='13:00'; People=20;  Action='none';    Outcome='INVALID_TIME';  Approver=$null },
  @{ Id='E';  Group='Main path';         Desc='6 hours, approved';                  Venue='hall-b'; Date='2027-01-15'; From='09:00'; To='15:00'; People=80;  Action='approve'; Outcome='APPROVED';      Approver='dean' },
  @{ Id='F';  Group='Main path';         Desc='150 people, rejected';               Venue='hall-b'; Date='2027-01-18'; From='10:00'; To='12:00'; People=150; Action='reject';  Outcome='REJECTED';      Approver='hod' },
  # Validation by the external worker
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
  @{ Id='R';  Group='Slot hold';         Desc='rebook the slot C let expire';       Venue='lab-1';  Date='2027-01-13'; From='10:00'; To='12:00'; People=30;  Action='approve'; Outcome='APPROVED';      Approver='lab-incharge' }
)
$byId = @{}; foreach ($s in $all) { $byId[$s.Id] = $s }

try { $seed = @((Invoke-RestMethod "$Mock/bookings") | ForEach-Object { $_ }) } catch { throw "Mock API not reachable at $Mock. Run scripts\start-mock.cmd first." }
if ($seed.Count -ne 3) { Write-Warning "Mock has $($seed.Count) bookings, not the 3 seed ones. Run scripts\reset-mock.cmd for clean results." }

$pik = @{}
$notes = @{}

# C first: its timers run while everything else is tested.
if (-not $SkipTimer) {
  $pik['C'] = Start-Booking $byId['C']
  $cTask = Find-ApprovalTask $pik['C']
  $cApproval = $cTask.processInstanceKey
  Write-Host "[C ] started $($pik['C']); approval waits in Hall Administration instance $cApproval (nobody will act)"
}

foreach ($id in 'A','B','D','E','F','G','H','I','J','K','L','M','N','O','P') {
  $s = $byId[$id]
  $pik[$id] = Start-Booking $s
  if ($s.Action -in 'approve','reject') {
    $task = Find-ApprovalTask $pik[$id]
    Complete-Approval $task ($s.Action -eq 'approve') "Completed by run-scenarios ($id)"
  }
  $null = Wait-Finished $pik[$id]
  Write-Host ("[{0,-2}] {1}" -f $id, $s.Desc)
}

# Q: hold a slot, try the same slot again, then approve the first one.
$pik['Q1'] = Start-Booking $byId['Q1']
$q1Task = Find-ApprovalTask $pik['Q1']
$pik['Q2'] = Start-Booking $byId['Q2']
$null = Wait-Finished $pik['Q2']
Complete-Approval $q1Task $true 'Completed by run-scenarios (Q1)'
$null = Wait-Finished $pik['Q1']
Write-Host '[Q ] Q2 tried the slot Q1 was holding; Q1 approved afterwards'

if (-not $SkipTimer) {
  Write-Host '[C ] waiting for the 1-minute reminder and the 2-minute expiry ...'
  $null = Wait-Finished $pik['C'] 200
  $reminder = (Invoke-Api POST '/v2/element-instances/search' @{ filter = @{ processInstanceKey = $cApproval; elementId = 'Worker_Reminder' } }).items
  $notes['C'] = $(if ($reminder.Count -gt 0 -and $reminder[0].state -eq 'COMPLETED') { 'reminder sent' } else { 'NO reminder' })
  $pik['R'] = Start-Booking $byId['R']
  Complete-Approval (Find-ApprovalTask $pik['R']) $true 'Completed by run-scenarios (R)'
  $null = Wait-Finished $pik['R']
  Write-Host '[R ] rebooked the slot C released'
}

$results = foreach ($s in $all) {
  if (-not $pik.ContainsKey($s.Id)) { continue }
  $p = $pik[$s.Id]
  $state = Wait-Finished $p 30
  $outcome = Get-ProcessVariable $p 'outcome'
  $approver = Get-ProcessVariable $p 'approver'
  $ok = $state -eq 'COMPLETED' -and $outcome -eq $s.Outcome -and $approver -eq $s.Approver
  if ($s.Id -eq 'C' -and $notes['C'] -ne 'reminder sent') { $ok = $false }
  [pscustomobject]@{
    Test     = $s.Id
    Group    = $s.Group
    Case     = $s.Desc
    Outcome  = $outcome
    Approver = $approver
    Note     = $notes[$s.Id]
    Result   = $(if ($ok) { 'PASS' } else { "FAIL (expected $($s.Outcome)/$($s.Approver), state $state)" })
  }
}
$results | Format-Table -AutoSize -Wrap
$passed = @($results | Where-Object { $_.Result -eq 'PASS' }).Count
Write-Host "$passed of $(@($results).Count) passed"

$bookings = @((Invoke-RestMethod "$Mock/bookings") | ForEach-Object { $_ })
$sent = @((Invoke-RestMethod "$Mock/notifications") | ForEach-Object { $_ })
Write-Host "Mock now holds $($bookings.Count) bookings and $($sent.Count) notifications."
