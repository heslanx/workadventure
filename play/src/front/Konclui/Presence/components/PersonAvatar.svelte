<script lang="ts">
    import { initialsOf, toneOf } from "../domain/personAvatar";

    // Initials on a tone of the name, drawn as the text the name is: names come from other people's browsers, so they
    // never go through `{@html}`. It carries no name of its own: whoever stacks it says in words who the people are.
    let { name }: { name: string } = $props();
</script>

<span class="person-avatar" data-tone={toneOf(name)}>{initialsOf(name)}</span>

<style>
    .person-avatar {
        display: grid;
        place-items: center;
        flex: none;
        box-sizing: border-box;
        width: 30px;
        height: 30px;
        border-radius: 50%;
        /* The ring is the colour of the surface under the stack, so each avatar reads as cut out of the next. */
        border: 2px solid var(--k-chrome);
        color: #fff;
        font-size: 12px;
        font-weight: 700;
        line-height: 1;
        letter-spacing: 0.02em;
        user-select: none;
    }
    /* The reference theme's six tones. White on each is at least 4.9:1. */
    .person-avatar[data-tone="0"] {
        background: #1e454d;
    }
    .person-avatar[data-tone="1"] {
        background: #142160;
    }
    .person-avatar[data-tone="2"] {
        background: #04706f;
    }
    .person-avatar[data-tone="3"] {
        background: #7a5a3a;
    }
    .person-avatar[data-tone="4"] {
        background: #0e7f66;
    }
    .person-avatar[data-tone="5"] {
        background: #5b3b6e;
    }
</style>
