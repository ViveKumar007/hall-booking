<#
  Runs test scenarios A-F (see README.md) through the Camunda 8 REST API, so Operate
  shows one finished instance per path. Same effect as filling the forms in Tasklist.

  Usage:
    powershell -ExecutionPolicy Bypass -File scripts\run-scenarios.ps1
    powershell -ExecutionPolicy Bypass -File scripts\run-scenarios.ps1 -SkipTimer   # skip C (saves 2 minutes)

  Run scripts\reset-mock.cmd first: scenarios A and E leave confirmed bookings behind,
  so a second run without a reset turns them into conflicts.
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

function Start-Booking($Vars) {
  (Invoke-Api POST '/v2/process-instances' @{ processDefinitionId = 'hall-booking'; variables = $Vars }).processInstanceKey
}

function Wait-UserTask([string]$Pik, [int]$TimeoutSec = 60) {
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  while ((Get-Date) -lt $deadline) {
    $r = Invoke-Api POST '/v2/user-tasks/search' @{ filter = @{ processInstanceKey = $Pik; state = 'CREATED' } }
    if ($r.items.Count -gt 0) { return $r.items[0].userTaskKey }
    Start-Sleep -Seconds 1
  }
  throw "No approval task appeared for instance $Pik"
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

function Get-ProcessVariable([string]$Pik, [string]$Name) {
  $r = Invoke-Api POST '/v2/variables/search' @{ filter = @{ processInstanceKey = $Pik; name = $Name } }
  if ($r.items.Count -eq 0) { return $null }
  $r.items[0].value | ConvertFrom-Json
}

# Approve: $true / $false completes the approval task with that value, $null means there is no task
# (B, D) or nobody acts on it (C, the timer releases the slot).
$scenarios = @(
  @{ Id = 'C'; Desc = 'lab-1, nobody approves, timer fires';   Venue = 'lab-1';  Date = '2026-10-22'; From = '10:00'; To = '12:00'; People = 30;  Approve = $null;  Outcome = 'EXPIRED';      Approver = 'lab-incharge' },
  @{ Id = 'A'; Desc = 'hall-a, free slot, approved';           Venue = 'hall-a'; Date = '2026-10-21'; From = '14:00'; To = '16:00'; People = 50;  Approve = $true;  Outcome = 'APPROVED';     Approver = 'admin-office' },
  @{ Id = 'B'; Desc = 'hall-a, overlaps seed booking 10-12';   Venue = 'hall-a'; Date = '2026-10-20'; From = '11:00'; To = '13:00'; People = 40;  Approve = $null;  Outcome = 'CONFLICT';     Approver = $null },
  @{ Id = 'D'; Desc = 'end time before start time';            Venue = 'hall-b'; Date = '2026-10-24'; From = '15:00'; To = '13:00'; People = 20;  Approve = $null;  Outcome = 'INVALID_TIME'; Approver = $null },
  @{ Id = 'E'; Desc = 'hall-b, 6 hours, approved';             Venue = 'hall-b'; Date = '2026-10-23'; From = '09:00'; To = '15:00'; People = 80;  Approve = $true;  Outcome = 'APPROVED';     Approver = 'dean' },
  @{ Id = 'F'; Desc = 'hall-b, 150 people, left unticked';     Venue = 'hall-b'; Date = '2026-10-25'; From = '10:00'; To = '12:00'; People = 150; Approve = $false; Outcome = 'REJECTED';     Approver = 'hod' }
)
if ($SkipTimer) { $scenarios = $scenarios | Where-Object { $_.Id -ne 'C' } }

try { $seed = @((Invoke-RestMethod "$Mock/bookings") | ForEach-Object { $_ }) } catch { throw "Mock API not reachable at $Mock. Run scripts\start-mock.cmd first." }
if ($seed.Count -ne 3) { Write-Warning "Mock has $($seed.Count) bookings, not the 3 seed ones. Run scripts\reset-mock.cmd for clean results." }

$started = @{}
foreach ($s in $scenarios) {
  $vars = @{
    requesterName = "Scenario $($s.Id)"; email = "scenario.$($s.Id.ToLower())@example.com"; purpose = $s.Desc
    venue = $s.Venue; bookingDate = $s.Date; startTime = $s.From; endTime = $s.To; attendees = $s.People
  }
  $started[$s.Id] = Start-Booking $vars
  Write-Host ("[{0}] started instance {1}  ({2})" -f $s.Id, $started[$s.Id], $s.Desc)
  if ($s.Id -eq 'C') { continue }   # checked at the end, after the 2-minute timer
  if ($null -ne $s.Approve) {
    $task = Wait-UserTask $started[$s.Id]
    Invoke-Api POST "/v2/user-tasks/$task/completion" @{ variables = @{ approved = $s.Approve; remarks = "Completed by run-scenarios ($($s.Id))" } } | Out-Null
    Write-Host ("[{0}] approval task completed with approved={1}" -f $s.Id, $s.Approve)
  }
}

if (-not $SkipTimer) { Write-Host '[C] waiting for the 2-minute approval timer to release the slot ...' }

$results = foreach ($s in $scenarios) {
  $pik = $started[$s.Id]
  $state = Wait-Finished $pik $(if ($s.Id -eq 'C') { 180 } else { 60 })
  $outcome = Get-ProcessVariable $pik 'outcome'
  $approver = Get-ProcessVariable $pik 'approver'
  [pscustomobject]@{
    Scenario = $s.Id
    Instance = $pik
    State    = $state
    Outcome  = $outcome
    Approver = $approver
    Result   = $(if ($state -eq 'COMPLETED' -and $outcome -eq $s.Outcome -and $approver -eq $s.Approver) { 'PASS' } else { "FAIL (expected $($s.Outcome)/$($s.Approver))" })
  }
}
$results | Format-Table -AutoSize

# PowerShell 5.1 returns a JSON array as one object; ForEach-Object unrolls it.
$bookings = @((Invoke-RestMethod "$Mock/bookings") | ForEach-Object { $_ })
$notes = @((Invoke-RestMethod "$Mock/notifications") | ForEach-Object { $_ })
Write-Host "Mock now holds $($bookings.Count) bookings and $($notes.Count) notifications:"
$bookings | Format-Table id, hall, day, startHour, endHour, status, requester -AutoSize
