@echo off
rem Restores the 3 seed bookings in the booking register, clears the notifications log and switches the register back
rem to normal. The backend must be running (start-backend.cmd). Run it before a demo or a test run.
rem Sends the register's shared key from secrets.cmd (the same key the REST connectors send as X-Register-Key).
if not exist "%~dp0secrets.cmd" copy /y "%~dp0secrets.example.cmd" "%~dp0secrets.cmd" >nul
call "%~dp0secrets.cmd"
"%SystemRoot%\System32\curl.exe" -s -X POST -H "X-Register-Key: %REGISTER_API_KEY%" http://localhost:8090/register/reset
echo.
