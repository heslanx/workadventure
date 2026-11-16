import type { DeepPartial } from "../DeepPartial";
import type { Translation } from "../i18n-types";

const camera: DeepPartial<Translation["camera"]> = {
    editCam: "แก้ไขกล้อง",
    editSpeaker: "แก้ไขเอาต์พุตเสียง",
    active: "เปิดใช้งาน",
    disabled: "ปิดใช้งาน",
    notRecommended: "ไม่แนะนำ",
    enable: {
        title: "เปิดกล้องและไมโครโฟนของคุณ",
        join: "เข้าร่วมห้อง",
        start: "ยินดีต้อนรับสู่หน้าตั้งค่าอุปกรณ์เสียงและวิดีโอ! ที่นี่คุณจะพบเครื่องมือที่ช่วยยกระดับประสบการณ์ออนไลน์ของคุณ ปรับการตั้งค่าตามที่ต้องการเพื่อแก้ไขปัญหาที่อาจเกิดขึ้น ตรวจสอบว่าอุปกรณ์ของคุณเชื่อมต่อถูกต้องและเป็นเวอร์ชันล่าสุด ลองทดสอบการตั้งค่าต่าง ๆ เพื่อหาสิ่งที่เหมาะกับคุณที่สุด",
    },
    help: {
        title: "ต้องการสิทธิ์เข้าถึงกล้อง / ไมโครโฟน",
        cameraTitle: "ต้องการสิทธิ์เข้าถึงกล้อง",
        microphoneTitle: "ต้องการสิทธิ์เข้าถึงไมโครโฟน",
        cameraPermissionDenied: "การเข้าถึงกล้องถูกปฏิเสธ",
        microphonePermissionDenied: "การเข้าถึงไมโครโฟนถูกปฏิเสธ",
        cameraMicrophonePermissionDenied: "การเข้าถึงกล้องและไมโครโฟนถูกปฏิเสธ",
        content: "คุณต้องอนุญาตให้เข้าถึงกล้องและไมโครโฟนในเบราว์เซอร์ของคุณ",
        cameraContent: "คุณต้องอนุญาตให้เข้าถึงกล้องในเบราว์เซอร์ของคุณ",
        microphoneContent: "คุณต้องอนุญาตให้เข้าถึงไมโครโฟนในเบราว์เซอร์ของคุณ",
        firefoxContent: 'กรุณาทำเครื่องหมายที่ช่อง "Remember this decision" หากไม่ต้องการให้ Firefox ถามสิทธิ์ซ้ำอีก',
        allow: "อนุญาตเว็บแคม",
        allowMicrophone: "อนุญาตไมโครโฟน",
        allowCameraMicrophone: "อนุญาตเว็บแคมและไมโครโฟน",
        continue: "ดำเนินการต่อโดยไม่ใช้เว็บแคม",
        continueWithoutMicrophone: "ดำเนินการต่อโดยไม่ใช้ไมโครโฟน",
        continueCameraMicrophone: "ดำเนินการต่อโดยไม่ใช้เว็บแคมและไมโครโฟน",
        showSteps: "ดูวิธีทำ",
        hideSteps: "ซ่อนขั้นตอน",
        steps: {
            chrome: "คลิกไอคอนแม่กุญแจทางซ้ายของแถบที่อยู่ ตั้งค่ากล้องหรือไมโครโฟนเป็น “อนุญาต” แล้วรีเฟรชหน้าเว็บ",
            firefox:
                "คลิกไอคอนสิทธิ์ทางซ้ายของแถบที่อยู่ นำรายการกล้องหรือไมโครโฟนที่ถูกบล็อกออก แล้วรีเฟรชหน้าเว็บและอนุญาตการเข้าถึงเมื่อมีการถาม",
            safari: "เปิดเมนู Safari เลือก “การตั้งค่าสำหรับเว็บไซต์นี้” ตั้งค่ากล้องหรือไมโครโฟนเป็น “อนุญาต” แล้วรีเฟรชหน้าเว็บ",
            android:
                "แตะไอคอนแม่กุญแจทางซ้ายของแถบที่อยู่ เปิด “สิทธิ์” ตั้งค่ากล้องหรือไมโครโฟนเป็น “อนุญาต” แล้วรีเฟรชหน้าเว็บ",
            other: "เปิดการตั้งค่าเว็บไซต์ของเบราว์เซอร์สำหรับหน้านี้ ตั้งค่ากล้องหรือไมโครโฟนเป็น “อนุญาต” แล้วรีเฟรชหน้าเว็บ",
        },
        screen: {
            firefox: "/resources/help-setting-camera-permission/en-US-firefox.png",
            chrome: "/resources/help-setting-camera-permission/en-US-firefox.png",
        },
        tooltip: {
            permissionDeniedTitle: "การเข้าถึงกล้องถูกบล็อก",
            permissionDeniedDesc:
                "เบราว์เซอร์ของคุณปฏิเสธการเข้าถึงกล้องสำหรับเว็บไซต์นี้ อนุญาตได้จากแถบที่อยู่ (ไอคอนแม่กุญแจหรือกล้อง) หรือในการตั้งค่าเว็บไซต์ ภาพประกอบด้านล่างตรงกับเบราว์เซอร์ของคุณ",
            permissionDeniedFix:
                "เบราว์เซอร์ของคุณปฏิเสธการเข้าถึงกล้องสำหรับเว็บไซต์นี้ อนุญาตได้จากแถบที่อยู่ (ไอคอนแม่กุญแจหรือกล้อง) หรือในการตั้งค่าเว็บไซต์ แล้วรีเฟรชหน้าเว็บ เลือกปุ่มนี้เพื่อดูขั้นตอน",
            noDeviceTitle: "ไม่พบกล้องที่ใช้งานได้",
            noDeviceDesc:
                "เบราว์เซอร์ของคุณไม่พบกล้องที่สามารถใช้งานได้ ลองใช้เบราว์เซอร์อื่น ตรวจสอบว่ามีกล้องเชื่อมต่ออยู่ ตรวจสอบการตั้งค่าคอมพิวเตอร์ของคุณ (ความเป็นส่วนตัว อุปกรณ์) หรือรีสตาร์ตคอมพิวเตอร์หากอุปกรณ์ควรใช้งานได้",
            deviceInUseTitle: "กล้องกำลังถูกใช้งาน",
            deviceInUseDesc: "แอปพลิเคชันอื่นกำลังใช้กล้องของคุณอยู่ ปิดแอปพลิเคชันนั้น แล้วลองอีกครั้ง",
            permissionMedia: {
                firefox: "/resources/help-setting-camera-permission/en-US-firefox.png",
                chrome: "/resources/help-setting-camera-permission/en-US-firefox.png",
                safari: "/resources/help-setting-camera-permission/en-US-firefox.png",
                android: "/resources/help-setting-camera-permission/en-US-firefox.png",
                default: "/resources/help-setting-camera-permission/en-US-firefox.png",
            },
        },
        microphoneTooltip: {
            permissionDeniedTitle: "การเข้าถึงไมโครโฟนถูกบล็อก",
            permissionDeniedDesc:
                "เบราว์เซอร์ของคุณปฏิเสธการเข้าถึงไมโครโฟนสำหรับเว็บไซต์นี้ อนุญาตได้จากแถบที่อยู่ (ไอคอนแม่กุญแจหรือไมโครโฟน) หรือในการตั้งค่าเว็บไซต์ ภาพประกอบด้านล่างตรงกับเบราว์เซอร์ของคุณ",
            permissionDeniedFix:
                "เบราว์เซอร์ของคุณปฏิเสธการเข้าถึงไมโครโฟนสำหรับเว็บไซต์นี้ อนุญาตได้จากแถบที่อยู่ (ไอคอนแม่กุญแจหรือไมโครโฟน) หรือในการตั้งค่าเว็บไซต์ แล้วรีเฟรชหน้าเว็บ เลือกปุ่มนี้เพื่อดูขั้นตอน",
            noDeviceTitle: "ไม่พบไมโครโฟนที่ใช้งานได้",
            noDeviceDesc:
                "เบราว์เซอร์ของคุณไม่พบไมโครโฟนที่สามารถใช้งานได้ ลองใช้เบราว์เซอร์อื่น ตรวจสอบว่ามีไมโครโฟนเชื่อมต่ออยู่ ตรวจสอบการตั้งค่าคอมพิวเตอร์ของคุณ (ความเป็นส่วนตัว อุปกรณ์) หรือรีสตาร์ตคอมพิวเตอร์หากอุปกรณ์ควรใช้งานได้",
            deviceInUseTitle: "ไมโครโฟนกำลังถูกใช้งาน",
            deviceInUseDesc: "แอปพลิเคชันอื่นกำลังใช้ไมโครโฟนของคุณอยู่ ปิดแอปพลิเคชันนั้น แล้วลองอีกครั้ง",
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
        title: "ข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์รีเลย์วิดีโอ",
        titlePending: "กำลังรอการเชื่อมต่อเซิร์ฟเวอร์รีเลย์วิดีโอ",
        error: "ไม่สามารถเข้าถึงเซิร์ฟเวอร์ TURN ได้",
        content: "ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์รีเลย์วิดีโอได้ คุณอาจไม่สามารถสื่อสารกับผู้ใช้คนอื่นได้",
        solutionVpn: "หากคุณ<strong>เชื่อมต่อผ่าน VPN</strong> กรุณาตัดการเชื่อมต่อ VPN แล้วรีเฟรชหน้าเว็บ",
        solutionVpnNotAskAgain: "เข้าใจแล้ว ไม่ต้องเตือนฉันอีก 🫡",
        solutionHotspot:
            "หากคุณอยู่ในเครือข่ายที่ถูกจำกัด (เครือข่ายบริษัท...) ลองเปลี่ยนเครือข่าย เช่น สร้าง<strong>ฮอตสปอต Wifi</strong> ด้วยโทรศัพท์ของคุณแล้วเชื่อมต่อผ่านโทรศัพท์",
        solutionNetworkAdmin: "หากคุณเป็น<strong>ผู้ดูแลเครือข่าย</strong> กรุณาดูคู่มือ ",
        preparingYouNetworkGuide: '"Preparing your network"',
        refresh: "รีเฟรช",
        continue: "ดำเนินการต่อ",
        newDeviceDetected: "ตรวจพบอุปกรณ์ใหม่ {device} 🎉 เปลี่ยนไหม? [SPACE] ไม่สนใจ [ESCAPE]",
        newDeviceSwitch: "เปลี่ยน",
        newDeviceIgnore: "ไม่สนใจ",
        newDeviceAnnouncement: "ตรวจพบอุปกรณ์ใหม่: {device} กด Space เพื่อเปลี่ยนไปใช้ หรือกด Escape เพื่อไม่สนใจ",
    },
    my: {
        silentZone: "โซนเงียบ",
        silentZoneDesc: "คุณอยู่ในโซนเงียบ ไม่มีใครพูดคุยกับคุณได้ที่นี่ และไมโครโฟนกับกล้องของคุณถูกปิดอยู่",
        nameTag: "คุณ",
        loading: "กำลังโหลดกล้องของคุณ...",
    },
    disable: "ปิดกล้องของคุณ",
    menu: {
        moreAction: "การดำเนินการเพิ่มเติม",
        closeMenu: "ปิดเมนู",
        senPrivateMessage: "ส่งข้อความส่วนตัว (เร็ว ๆ นี้)",
        giveFloor: "ให้สิทธิ์การพูด",
        revokeFloor: "เรียกคืนสิทธิ์การพูด",
        muteAudioUser: "ปิดเสียง",
        askToMuteAudioUser: "ขอให้ปิดเสียง",
        muteAudioEveryBody: "ปิดเสียงสำหรับทุกคน",
        muteVideoUser: "ปิดวิดีโอ",
        askToMuteVideoUser: "ขอให้ปิดวิดีโอ",
        muteVideoEveryBody: "ปิดวิดีโอสำหรับทุกคน",
        blockOrReportUser: "การจัดการ",
        mutedAudioNotice: "ไมโครโฟนของ {name} ถูกปิดเสียงอยู่ มีเพียงเจ้าตัวที่เปิดกลับได้",
        askedMuteAudioNotice: "ขอให้ {name} ปิดเสียงไมโครโฟนแล้ว",
        mutedVideoNotice: "กล้องของ {name} ปิดอยู่ มีเพียงเจ้าตัวที่เปิดกลับได้",
        askedMuteVideoNotice: "ขอให้ {name} ปิดกล้องแล้ว",
        confirmMuteAudioEveryBodyTitle: "ปิดเสียงไมโครโฟนของทุกคนไหม?",
        confirmMuteAudioEveryBodyMessage:
            "การดำเนินการนี้จะปิดเสียงทุกคนในการสนทนานี้ มีเพียงเจ้าตัวเท่านั้นที่เปิดไมโครโฟนของตนกลับได้",
        confirmMuteAudioEveryBodyMessageCount:
            "การดำเนินการนี้จะปิดเสียง {count} คนในการสนทนานี้ มีเพียงเจ้าตัวเท่านั้นที่เปิดไมโครโฟนของตนกลับได้",
        confirmMuteAudioEveryBodyAction: "ปิดเสียงทุกคน",
        mutedAudioEveryBodyNotice: "ปิดเสียงไมโครโฟนของทุกคนแล้ว มีเพียงเจ้าตัวที่เปิดกลับได้",
        mutedAudioEveryBodyNoticeCount: "ปิดเสียงไมโครโฟนของ {count} คนแล้ว มีเพียงเจ้าตัวที่เปิดกลับได้",
        confirmMuteVideoEveryBodyTitle: "ปิดกล้องของทุกคนไหม?",
        confirmMuteVideoEveryBodyMessage:
            "การดำเนินการนี้จะปิดกล้องของทุกคนในการสนทนานี้ มีเพียงเจ้าตัวเท่านั้นที่เปิดกล้องของตนกลับได้",
        confirmMuteVideoEveryBodyMessageCount:
            "การดำเนินการนี้จะปิดกล้องของ {count} คนในการสนทนานี้ มีเพียงเจ้าตัวเท่านั้นที่เปิดกล้องของตนกลับได้",
        confirmMuteVideoEveryBodyAction: "ปิดกล้องทุกคน",
        mutedVideoEveryBodyNotice: "ปิดกล้องของทุกคนแล้ว มีเพียงเจ้าตัวที่เปิดกลับได้",
        mutedVideoEveryBodyNoticeCount: "ปิดกล้องของ {count} คนแล้ว มีเพียงเจ้าตัวที่เปิดกลับได้",
        alreadyMuted: "ปิดเสียงอยู่แล้ว",
        videoAlreadyOff: "ปิดวิดีโออยู่แล้ว",
    },
    startError: {
        camera: "กล้องของคุณไม่เริ่มทำงาน คนอื่นมองไม่เห็นคุณ ปิดแอปอื่นที่ใช้กล้องอยู่แล้วลองอีกครั้ง",
        microphone: "ไมโครโฟนของคุณไม่เริ่มทำงาน คนอื่นไม่ได้ยินคุณ ปิดแอปอื่นที่ใช้ไมโครโฟนอยู่แล้วลองอีกครั้ง",
    },
};

export default camera;
