@echo off
rem Deploys the DMN, the three forms and the BPMN (both pools) to the local cluster in one deployment.
cd /d "%~dp0.."
"%SystemRoot%\System32\curl.exe" -s -X POST http://localhost:8080/v2/deployments -F "resources=@decide-approver.dmn" -F "resources=@booking-request-form.form" -F "resources=@approval-form.form" -F "resources=@service-fix-form.form" -F "resources=@hall-booking.bpmn"
echo.
pause
