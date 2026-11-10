@echo off
rem Deploys the DMN, the three forms, the two child processes (send-email, hall-approval) and the main process to the local cluster in one deployment.
cd /d "%~dp0.."
"%SystemRoot%\System32\curl.exe" -s -X POST http://localhost:8080/v2/deployments -F "resources=@decide-approver.dmn" -F "resources=@booking-request-form.form" -F "resources=@approval-form.form" -F "resources=@service-fix-form.form" -F "resources=@send-email.bpmn" -F "resources=@hall-approval.bpmn" -F "resources=@hall-booking.bpmn"
echo.
pause
