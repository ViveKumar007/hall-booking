@echo off
rem Restores the 3 seed bookings and clears notifications. Safe while the mock is running.
copy /y "%~dp0..\mock\db.seed.json" "%~dp0..\mock\db.json" >nul
echo Mock data reset to seed.
