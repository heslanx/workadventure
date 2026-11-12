"""Insert deviceInUseTitle/deviceInUseDesc after noDeviceDesc in each locale's camera.ts (tooltip, then microphoneTooltip)."""
import sys, pathlib

T = {
    "en-US": [("Camera in use", "Your camera is being used by another application. Close that application, then try again."),
              ("Microphone in use", "Your microphone is being used by another application. Close that application, then try again.")],
    "ar-SA": [("الكاميرا قيد الاستخدام", "تطبيق آخر يستخدم الكاميرا. أغلق ذلك التطبيق، ثم حاول مرة أخرى."),
              ("الميكروفون قيد الاستخدام", "تطبيق آخر يستخدم الميكروفون. أغلق ذلك التطبيق، ثم حاول مرة أخرى.")],
    "ca-ES": [("Càmera en ús", "Una altra aplicació està fent servir la càmera. Tanqueu aquella aplicació i torneu-ho a provar."),
              ("Micròfon en ús", "Una altra aplicació està fent servir el micròfon. Tanqueu aquella aplicació i torneu-ho a provar.")],
    "de-DE": [("Kamera wird verwendet", "Ihre Kamera wird von einer anderen Anwendung verwendet. Schließen Sie diese Anwendung und versuchen Sie es dann erneut."),
              ("Mikrofon wird verwendet", "Ihr Mikrofon wird von einer anderen Anwendung verwendet. Schließen Sie diese Anwendung und versuchen Sie es dann erneut.")],
    "dsb-DE": [("Kamera se wužywa", "Wašu kameru wužywa druga aplikacija. Zacyńśo tu aplikaciju a wopytajśo to pón znowego."),
               ("Mikrofon se wužywa", "Waš mikrofon wužywa druga aplikacija. Zacyńśo tu aplikaciju a wopytajśo to pón znowego.")],
    "es-ES": [("Cámara en uso", "Otra aplicación está usando la cámara. Cierra esa aplicación y vuelve a intentarlo."),
              ("Micrófono en uso", "Otra aplicación está usando el micrófono. Cierra esa aplicación y vuelve a intentarlo.")],
    "fr-FR": [("Caméra déjà utilisée", "Une autre application utilise votre caméra. Fermez cette application, puis réessayez."),
              ("Microphone déjà utilisé", "Une autre application utilise votre microphone. Fermez cette application, puis réessayez.")],
    "hsb-DE": [("Kamera so wužiwa", "Wašu kameru wužiwa druha aplikacija. Začińće tu aplikaciju a spytajće to potom znowa."),
               ("Mikrofon so wužiwa", "Waš mikrofon wužiwa druha aplikacija. Začińće tu aplikaciju a spytajće to potom znowa.")],
    "it-IT": [("Fotocamera in uso", "Un’altra applicazione sta usando la fotocamera. Chiudi quell’applicazione, poi riprova."),
              ("Microfono in uso", "Un’altra applicazione sta usando il microfono. Chiudi quell’applicazione, poi riprova.")],
    "ja-JP": [("カメラは使用中です", "別のアプリケーションがカメラを使用しています。そのアプリケーションを閉じてから、もう一度お試しください。"),
              ("マイクは使用中です", "別のアプリケーションがマイクを使用しています。そのアプリケーションを閉じてから、もう一度お試しください。")],
    "ko-KR": [("카메라 사용 중", "다른 애플리케이션이 카메라를 사용하고 있습니다. 해당 애플리케이션을 닫은 후 다시 시도해 보세요."),
              ("마이크 사용 중", "다른 애플리케이션이 마이크를 사용하고 있습니다. 해당 애플리케이션을 닫은 후 다시 시도해 보세요.")],
    "nl-NL": [("Camera in gebruik", "Een andere applicatie gebruikt je camera. Sluit die applicatie en probeer het daarna opnieuw."),
              ("Microfoon in gebruik", "Een andere applicatie gebruikt je microfoon. Sluit die applicatie en probeer het daarna opnieuw.")],
    "pt-BR": [("Câmera em uso", "Outro aplicativo está usando a câmera. Feche esse aplicativo e tente novamente."),
              ("Microfone em uso", "Outro aplicativo está usando o microfone. Feche esse aplicativo e tente novamente.")],
    "th-TH": [("กล้องกำลังถูกใช้งาน", "แอปพลิเคชันอื่นกำลังใช้กล้องของคุณอยู่ ปิดแอปพลิเคชันนั้น แล้วลองอีกครั้ง"),
              ("ไมโครโฟนกำลังถูกใช้งาน", "แอปพลิเคชันอื่นกำลังใช้ไมโครโฟนของคุณอยู่ ปิดแอปพลิเคชันนั้น แล้วลองอีกครั้ง")],
    "vi-VN": [("Camera đang được sử dụng", "Một ứng dụng khác đang sử dụng camera của bạn. Hãy đóng ứng dụng đó rồi thử lại."),
              ("Micrô đang được sử dụng", "Một ứng dụng khác đang sử dụng micrô của bạn. Hãy đóng ứng dụng đó rồi thử lại.")],
    "zh-CN": [("摄像头已被占用", "另一个应用程序正在使用摄像头。请关闭该应用程序，然后重试。"),
              ("麦克风已被占用", "另一个应用程序正在使用麦克风。请关闭该应用程序，然后重试。")],
    "zh-TW": [("攝影機使用中", "另一個應用程式正在使用攝影機。請關閉該應用程式，然後再試一次。"),
              ("麥克風使用中", "另一個應用程式正在使用麥克風。請關閉該應用程式，然後再試一次。")],
}

root = pathlib.Path(sys.argv[1])
locales = sorted(p.name for p in root.iterdir() if (p / "camera.ts").is_file())
assert locales == sorted(T), (locales, sorted(T))
for loc in locales:
    path = root / loc / "camera.ts"
    lines = path.read_text(encoding="utf-8").split("\n")
    idx = [i for i, l in enumerate(lines) if l == "            noDeviceDesc:"]
    assert len(idx) == 2, (loc, idx)
    tooltip = [i for i, l in enumerate(lines) if l == "        tooltip: {"]
    mic = [i for i, l in enumerate(lines) if l == "        microphoneTooltip: {"]
    assert len(tooltip) == 1 and len(mic) == 1 and tooltip[0] < idx[0] < mic[0] < idx[1], loc
    for (title, desc), i in reversed(list(zip(T[loc], idx))):
        assert lines[i + 1].startswith('                "') and lines[i + 1].endswith('",'), (loc, i)
        assert '"' not in title and '"' not in desc
        lines[i + 2:i + 2] = [
            f'            deviceInUseTitle: "{title}",',
            "            deviceInUseDesc:",
            f'                "{desc}",',
        ]
    path.write_text("\n".join(lines), encoding="utf-8")
    print(loc, "ok")
