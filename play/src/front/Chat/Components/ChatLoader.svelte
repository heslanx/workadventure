<script lang="ts">
    import { IconLoader } from "@wa-icons";

    interface Props {
        label: string;
    }

    let { label }: Props = $props();
</script>

<div class="text-gray-400 text-xl flex flex-col items-center my-10 gap-2" role="status">
    <IconLoader
        aria-hidden="true"
        class="animate-[spin_2s_linear_infinite] motion-reduce:animate-none"
        font-size={40}
    />
    <p class="m-0">
        {label}
    </p>
</div>
