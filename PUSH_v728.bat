@echo off
echo   BILLR v7.2.8 - Full offerte page + bevestigingsmail + mobile fixes
echo.
echo Kopieer billr_pkg inhoud naar billr map
pause

cd /d C:\Users\woute\billr-v2
xcopy "C:\Users\woute\OneDrive\Documenten\billr\*" "C:\Users\woute\billr-v2\" /E /Y
git add .
git commit -m "v7.2.8: full offerte klantpagina, bevestigingsmail template, calendar links, view tracking, mobile fixes"
git push

echo KLAAR!
pause
