@echo off
cd /d "C:\Users\denis\OneDrive\Desktop\Formio-PodnapisiNET-Addon"
echo ==========================================
echo 🔄 Posodabljam Formio Podnapisi.NET Addon ...
echo ==========================================
git add .
git commit -m "Samodejna posodobitev %date% %time%"
git push
echo.
echo ✅ Poslano na GitHub. Render bo sam posodobil v 1-2 minutah.
pause
