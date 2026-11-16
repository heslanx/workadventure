import type { DeepPartial } from "../DeepPartial";
import type { Translation } from "../i18n-types";

const camera: DeepPartial<Translation["camera"]> = {
    editCam: "تحرير الكاميرا",
    editSpeaker: "تحرير إخراج الصوت",
    active: "نشط",
    disabled: "معطل",
    notRecommended: "غير موصى به",
    enable: {
        title: "يرجى تشغيل الكاميرا والميكروفون.", // Please turn on your camera and microphone.
        join: "الانضمام إلى الغرفة", // Join the room
        start: "لنبدأ!", // Let's start!
    },
    help: {
        title: "مطلوب الوصول إلى الكاميرا / الميكروفون", // Access to camera/microphone required
        cameraTitle: "مطلوب الوصول إلى الكاميرا",
        microphoneTitle: "مطلوب الوصول إلى الميكروفون",
        cameraPermissionDenied: "تم رفض إذن الكاميرا",
        microphonePermissionDenied: "تم رفض إذن الميكروفون",
        cameraMicrophonePermissionDenied: "تم رفض أذني الكاميرا والميكروفون",
        content: "يجب السماح بالوصول إلى الكاميرا والميكروفون في المتصفح.", // Access to camera and microphone must be allowed in the browser.
        cameraContent: "يجب السماح بالوصول إلى الكاميرا في المتصفح.",
        microphoneContent: "يجب السماح بالوصول إلى الميكروفون في المتصفح.",
        firefoxContent: 'يرجى النقر على زر "حفظ هذا القرار" لمنع طلبات الإذن المتكررة في Firefox.', // Please click the "Save this decision" button to prevent repeated permission requests in Firefox.
        continue: "المتابعة بدون كاميرا", // Continue without camera
        continueWithoutMicrophone: "المتابعة بدون ميكروفون",
        continueCameraMicrophone: "المتابعة بدون كاميرا وميكروفون",
        allow: "السماح بالكاميرا", // Allow camera
        allowMicrophone: "السماح بالميكروفون",
        allowCameraMicrophone: "السماح بالكاميرا والميكروفون",
        showSteps: "أرني كيف",
        hideSteps: "إخفاء الخطوات",
        steps: {
            chrome: "انقر على أيقونة القفل في بداية شريط العناوين، واضبط الكاميرا أو الميكروفون على «السماح»، ثم أعد تحميل الصفحة.",
            firefox:
                "انقر على أيقونة الأذونات في بداية شريط العناوين، وأزل إدخال الكاميرا أو الميكروفون المحظور، ثم أعد تحميل الصفحة واسمح بالوصول عند الطلب.",
            safari: "افتح قائمة Safari، واختر «إعدادات هذا الموقع»، واضبط الكاميرا أو الميكروفون على «السماح»، ثم أعد تحميل الصفحة.",
            android:
                "اضغط على أيقونة القفل في بداية شريط العناوين، وافتح «الأذونات»، واضبط الكاميرا أو الميكروفون على «السماح»، ثم أعد تحميل الصفحة.",
            other: "افتح إعدادات الموقع لهذه الصفحة في متصفحك، واضبط الكاميرا أو الميكروفون على «السماح»، ثم أعد تحميل الصفحة.",
        },
        screen: {
            firefox: "/resources/help-setting-camera-permission/en-US-firefox.png",
            chrome: "/resources/help-setting-camera-permission/en-US-firefox.png",
        },
        tooltip: {
            permissionDeniedTitle: "تم حظر الوصول إلى الكاميرا",
            permissionDeniedDesc:
                "رفض المتصفح الوصول إلى الكاميرا لهذا الموقع. اسمح بها من شريط العناوين (أيقونة القفل أو الكاميرا) أو من إعدادات الموقع. الصورة أدناه تناسب متصفحك.",
            permissionDeniedFix:
                "رفض المتصفح الوصول إلى الكاميرا لهذا الموقع. اسمح بها من شريط العناوين (أيقونة القفل أو الكاميرا) أو من إعدادات الموقع، ثم أعد التحميل. حدد هذا الزر لعرض الخطوات.",
            noDeviceTitle: "لا توجد كاميرا صالحة للاستخدام",
            noDeviceDesc:
                "المتصفح لا يكتشف أي كاميرا يمكن استخدامها. جرّب متصفحًا آخر، أو تحقق من توصيل الكاميرا، أو تحقق من إعدادات الجهاز (الخصوصية، الأجهزة)، أو أعد تشغيل الجهاز إذا كان يفترض أن يعمل.",
            deviceInUseTitle: "الكاميرا قيد الاستخدام",
            deviceInUseDesc: "تطبيق آخر يستخدم الكاميرا. أغلق ذلك التطبيق، ثم حاول مرة أخرى.",
            permissionMedia: {
                firefox: "/resources/help-setting-camera-permission/en-US-firefox.png",
                chrome: "/resources/help-setting-camera-permission/en-US-firefox.png",
                safari: "/resources/help-setting-camera-permission/en-US-firefox.png",
                android: "/resources/help-setting-camera-permission/en-US-firefox.png",
                default: "/resources/help-setting-camera-permission/en-US-firefox.png",
            },
        },
        microphoneTooltip: {
            permissionDeniedTitle: "تم حظر الوصول إلى الميكروفون",
            permissionDeniedDesc:
                "رفض المتصفح الوصول إلى الميكروفون لهذا الموقع. اسمح به من شريط العناوين (أيقونة القفل أو الميكروفون) أو من إعدادات الموقع. الصورة أدناه تناسب متصفحك.",
            permissionDeniedFix:
                "رفض المتصفح الوصول إلى الميكروفون لهذا الموقع. اسمح به من شريط العناوين (أيقونة القفل أو الميكروفون) أو من إعدادات الموقع، ثم أعد التحميل. حدد هذا الزر لعرض الخطوات.",
            noDeviceTitle: "لا يوجد ميكروفون صالح للاستخدام",
            noDeviceDesc:
                "المتصفح لا يكتشف أي ميكروفون يمكن استخدامه. جرّب متصفحًا آخر، أو تحقق من توصيل الميكروفون، أو تحقق من إعدادات الجهاز (الخصوصية، الأجهزة)، أو أعد تشغيل الجهاز إذا كان يفترض أن يعمل.",
            deviceInUseTitle: "الميكروفون قيد الاستخدام",
            deviceInUseDesc: "تطبيق آخر يستخدم الميكروفون. أغلق ذلك التطبيق، ثم حاول مرة أخرى.",
            permissionMedia: {
                firefox: "/resources/help-setting-camera-permission/en-US-firefox.png",
                chrome: "/resources/help-setting-camera-permission/en-US-firefox.png",
                safari: "/resources/help-setting-camera-permission/en-US-firefox.png",
                android: "/resources/help-setting-camera-permission/en-US-firefox.png",
                default: "/resources/help-setting-camera-permission/en-US-firefox.png",
            },
        },
    },
    webrtc: {
        title: "خادم ترحيل الفيديو لا يستجيب - خطأ", // The video relay server is not responding - Error
        titlePending: "الاتصال بخادم ترحيل الفيديو", // Connecting to the video relay server
        error: 'خادم "TURN" غير متاح', // "TURN" server not reachable
        content: "لم يتمكن من إنشاء اتصال بخادم ترحيل الفيديو. قد لا تتمكن من التواصل مع المستخدمين الآخرين.", // A connection to the video relay server could not be established. You may not be able to communicate with other users.
        solutionVpn: "إذا كنت تتصل عبر VPN، يرجى قطع الاتصال بـ VPN وتحديث الصفحة.", // If you are connecting via VPN, please disconnect from the VPN and refresh the page.
        solutionHotspot:
            "إذا كنت في شبكة مقيدة (شبكة الشركة...)، حاول تغيير الشبكة. على سبيل المثال، قم بإنشاء نقطة اتصال Wi-Fi باستخدام هاتفك واتصل عبر هاتفك.", // If you are in a restricted network (company network...), try changing the network. For example, create a Wi-Fi hotspot with your phone and connect via your phone.
        solutionNetworkAdmin: "إذا كنت مسؤول الشبكة، تحقق من", // If you are a network administrator, check the
        preparingYouNetworkGuide: 'دليل "إعداد شبكتك"', // "Preparing your network" guide
        refresh: "تحديث", // Refresh
        continue: "استمرار", // Continue
        solutionVpnNotAskAgain: "فهمت. لا تحذرني مرة أخرى 🫡",
        newDeviceDetected: "تم اكتشاف جهاز جديد {device} 🎉 التبديل؟ [SPACE] تجاهل [ESC]",
        newDeviceSwitch: "تبديل",
        newDeviceIgnore: "تجاهل",
        newDeviceAnnouncement: "تم اكتشاف جهاز جديد: {device}. اضغط Space للتبديل إليه، أو Escape لتجاهله.",
    },
    my: {
        silentZone: "منطقة صامتة", // Silent zone
        nameTag: "أنت", // You
        silentZoneDesc:
            "أنت في منطقة صامتة. لا يمكنك سوى رؤية وسماع الأشخاص الذين معك. لا يمكنك رؤية أو سماع الأشخاص الآخرين في الغرفة.",
        loading: "جارٍ تحميل الكاميرا...", // Loading your camera...
    },
    disable: "إيقاف الكاميرا", // Disable camera
    menu: {
        moreAction: "خيارات إضافية", // More actions
        closeMenu: "إغلاق القائمة", // Close menu
        senPrivateMessage: "إرسال رسالة خاصة (قريبًا)", // Send private message (coming soon)
        giveFloor: "إعطاء الكلمة",
        revokeFloor: "سحب الكلمة", // Kick off user
        muteAudioUser: "كتم صوت المستخدم", // Mute user's audio
        askToMuteAudioUser: "طلب كتم الصوت", // Ask to mute audio
        muteAudioEveryBody: "كتم الصوت للجميع", // Mute audio for everybody
        muteVideoUser: "كتم فيديو المستخدم", // Mute user's video
        askToMuteVideoUser: "طلب كتم الفيديو", // Ask to mute video
        muteVideoEveryBody: "كتم الفيديو للجميع", // Mute video for everybody
        blockOrReportUser: "الإشراف", // Moderation
        mutedAudioNotice: "ميكروفون {name} مكتوم. هو وحده من يمكنه تشغيله مجددًا.",
        askedMuteAudioNotice: "طُلب من {name} كتم الميكروفون.",
        mutedVideoNotice: "كاميرا {name} متوقفة. هو وحده من يمكنه تشغيلها مجددًا.",
        askedMuteVideoNotice: "طُلب من {name} إيقاف الكاميرا.",
        confirmMuteAudioEveryBodyTitle: "كتم ميكروفون الجميع؟",
        confirmMuteAudioEveryBodyMessage:
            "سيؤدي هذا إلى كتم الجميع في هذه المحادثة. كل شخص وحده من يمكنه إعادة تشغيل ميكروفونه.",
        confirmMuteAudioEveryBodyMessageCount:
            "سيؤدي هذا إلى كتم {count} {{أشخاص|شخص|شخصين|أشخاص|شخصًا|شخص}} في هذه المحادثة. كل شخص وحده من يمكنه إعادة تشغيل ميكروفونه.",
        confirmMuteAudioEveryBodyAction: "كتم الجميع",
        mutedAudioEveryBodyNotice: "تم كتم ميكروفون الجميع. كل شخص وحده من يمكنه إعادة تشغيل ميكروفونه.",
        mutedAudioEveryBodyNoticeCount:
            "تم كتم الميكروفون لدى {count} {{أشخاص|شخص|شخصين|أشخاص|شخصًا|شخص}}. كل شخص وحده من يمكنه إعادة تشغيل ميكروفونه.",
        confirmMuteVideoEveryBodyTitle: "إيقاف كاميرا الجميع؟",
        confirmMuteVideoEveryBodyMessage:
            "سيؤدي هذا إلى إيقاف كاميرا الجميع في هذه المحادثة. كل شخص وحده من يمكنه إعادة تشغيل كاميرته.",
        confirmMuteVideoEveryBodyMessageCount:
            "سيؤدي هذا إلى إيقاف كاميرا {count} {{أشخاص|شخص|شخصين|أشخاص|شخصًا|شخص}} في هذه المحادثة. كل شخص وحده من يمكنه إعادة تشغيل كاميرته.",
        confirmMuteVideoEveryBodyAction: "إيقاف الكاميرات",
        mutedVideoEveryBodyNotice: "كاميرا الجميع متوقفة. كل شخص وحده من يمكنه إعادة تشغيل كاميرته.",
        mutedVideoEveryBodyNoticeCount:
            "تم إيقاف الكاميرا لدى {count} {{أشخاص|شخص|شخصين|أشخاص|شخصًا|شخص}}. كل شخص وحده من يمكنه إعادة تشغيل كاميرته.",
        alreadyMuted: "مكتوم بالفعل",
        videoAlreadyOff: "الفيديو متوقف بالفعل",
    },
    startError: {
        camera: "لم تبدأ الكاميرا. لا يمكن للآخرين رؤيتك. أغلق التطبيقات الأخرى التي تستخدمها وحاول مرة أخرى.",
        microphone: "لم يبدأ الميكروفون. لا يمكن للآخرين سماعك. أغلق التطبيقات الأخرى التي تستخدمه وحاول مرة أخرى.",
    },
};

export default camera;
