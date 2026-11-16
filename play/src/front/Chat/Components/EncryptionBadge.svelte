<script lang="ts">
    import { IconShieldLockFilled } from "../../Components/Icons";
    import LL from "../../../i18n/i18n-svelte";
</script>

<div class="absolute bottom-[4px] right-[-4px] h-3 w-3">
    <IconShieldLockFilled font-size={10} role="img" aria-label={$LL.chat.roomPanel.home.encrypted()} />
</div>
