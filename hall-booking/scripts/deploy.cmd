@echo off
rem Deploys the DMN, the three forms, the child process and the main process to the local cluster in one deployment.
cd /d "%~dp0.."
"%SystemRoot%\System32\curl.exe" -s -X POST http://localhost:8080/v2/deployments -F "resources=@decide-approver.dmn" -F "resources=@booking-request-form.form" -F "resources=@approval-form.form" -F "resources=@service-fix-form.form" -F "resources=@hall-approval.bpmn" -F "resources=@hall-booking.bpmn"
echo.
pause
