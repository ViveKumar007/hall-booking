@echo off
rem Deploys the DMN, both forms and the BPMN to the local cluster in one deployment.
cd /d "%~dp0.."
"%SystemRoot%\System32\curl.exe" -s -X POST http://localhost:8080/v2/deployments -F "resources=@decide-approver.dmn" -F "resources=@booking-request-form.form" -F "resources=@approval-form.form" -F "resources=@hall-booking.bpmn"
echo.
pause
