<script lang="ts">
    import { LL } from "../../../i18n/i18n-svelte";
    import { connectionManager } from "../../Connection/ConnectionManager";
    import { REPORT_ISSUES_URL } from "../../Enum/EnvironmentVariable";

    function getReportIssuesUrl() {
        return connectionManager.currentRoom?.reportIssuesUrl ?? REPORT_ISSUES_URL;
    }
</script>

<div style="height: calc(100% - 40px);">
    <section class="h-full">
        <iframe title={$LL.menu.sub.report()} src={getReportIssuesUrl()} class="border-0 w-full h-full"></iframe>
    </section>
</div>
