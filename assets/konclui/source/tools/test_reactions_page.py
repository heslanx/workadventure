"""The reaction overlay (hq-office/reactions/index.html): its stylesheet read without a browser.
Run (from assets/konclui/source, isolated mode as the repository asks): python3 -I tools/test_reactions_page.py
With KONCLUI_DIST set, the built reactions/index.html must also be the source file byte for byte.

Why a stylesheet test: the page delays each clap with animation-delay. An animation that waits out its delay without a
backwards fill shows the element's own style, not its first keyframe; the old page (fill-mode `forwards` only, base
opacity 1) therefore drew claps 2 to 5 at full opacity on the origin for 70 to 280 ms before they flew (audit item N55,
rule R15). What is checked, for the page as shipped and again inside `prefers-reduced-motion`:
  * every animated element is invisible in its own style (opacity 0), so nothing shows before an animation starts;
  * every animation of an element that has a delay fills `both`;
  * every element runs an opacity animation that starts and ends at 0, so it is invisible again once it has ended;
  * movement is whole pixels: the transform/translate keyframes carry no rotation, no fractional scale and no fractional
    pixel literal, and a moving keyframe set is stepped (steps(...)), with a literal travel that the steps divide into
    whole pixels, or snapped with round();
  * the longest life (delay + duration) is shorter than the time social.mjs lets the page live.
The CHECKER is itself tested against the old page's stylesheet (kept below as OLD_STYLE) and a few small variants, each
of which must fail the check that names it."""
import os
import re
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
SOURCE = HERE.parent / 'hq-office'
PAGE = SOURCE / 'reactions' / 'index.html'
SOCIAL = SOURCE / 'runtime' / 'social.mjs'

# The stylesheet of the page before the audit fix (hq-office/reactions/index.html at 0832ea7ea), verbatim.
OLD_STYLE = """
html, body { margin: 0; width: 100%; height: 100%; background: transparent; overflow: hidden; color-scheme: dark; }
.p { position: absolute; left: 50%; top: 70%; will-change: transform, opacity; }
.clap { font-size: 18px; animation: rise 1.4s cubic-bezier(.16,1,.3,1) forwards; }
.bit { width: 4px; height: 7px; border-radius: 1px; animation: burst 1.5s cubic-bezier(.16,1,.3,1) forwards; }
@keyframes rise { from { transform: translate(var(--dx), 0) scale(.6); opacity: 0; }
  20% { opacity: 1; } to { transform: translate(calc(var(--dx) * 1.6), -54px) scale(1); opacity: 0; } }
@keyframes burst { from { transform: translate(0, 0) rotate(0); opacity: 1; }
  to { transform: translate(var(--dx), var(--dy)) rotate(var(--r)); opacity: 0; } }
@media (prefers-reduced-motion: reduce) { .clap, .bit { animation-duration: .01s; } }
"""
OLD_SCRIPT = "el.style.animationDelay = `${i * 70}ms`;"


# ---------------------------------------------------------------------------------------------------- the reader
def blocks(css, start=0):
    """[(prelude, body)] at one nesting level of `css` from `start`; a body that holds blocks stays text."""
    out, i, depth, begin, prelude_from = [], start, 0, None, start
    while i < len(css):
        ch = css[i]
        if ch == '{':
            if depth == 0:
                prelude, begin = css[prelude_from:i].strip(), i + 1
            depth += 1
        elif ch == '}':
            depth -= 1
            if depth == 0:
                out.append((prelude, css[begin:i]))
                prelude_from = i + 1
        i += 1
    return out


def declarations(body):
    """{property: value} of a declaration list (the last one wins, as in the cascade)."""
    result = {}
    for part in re.split(r';(?![^()]*\))', body):
        if ':' in part:
            name, value = part.split(':', 1)
            result[name.strip().lower()] = value.strip()
    return result


def split_top(value, sep=','):
    parts, depth, current = [], 0, ''
    for ch in value:
        if ch == '(':
            depth += 1
        elif ch == ')':
            depth -= 1
        if ch == sep and depth == 0:
            parts.append(current.strip())
            current = ''
        else:
            current += ch
    parts.append(current.strip())
    return parts


def seconds(token):
    m = re.fullmatch(r'(-?[\d.]+)(ms|s)', token)
    return None if not m else float(m.group(1)) / (1000 if m.group(2) == 'ms' else 1)


FILLS = {'none', 'forwards', 'backwards', 'both'}


def parse_animation(value):
    """One animation of a shorthand list -> dict(name, duration, delay (seconds, or the string var(...)), fill, timing)."""
    tokens = split_top(value, ' ')
    a = {'name': None, 'duration': None, 'delay': 0.0, 'fill': 'none', 'timing': '', 'raw': value}
    times = []
    for t in tokens:
        if t in FILLS:
            a['fill'] = t
        elif t.startswith(('steps(', 'cubic-bezier(', 'linear(')) or t in ('linear', 'ease', 'ease-in', 'ease-out', 'ease-in-out'):
            a['timing'] = t
        elif seconds(t) is not None:
            times.append(seconds(t))
        elif t.startswith('var('):
            times.append(t)
        elif a['name'] is None and re.fullmatch(r'[a-zA-Z_][\w-]*', t):
            a['name'] = t
    a['duration'] = times[0] if times else 0.0
    a['delay'] = times[1] if len(times) > 1 else 0.0
    return a


class Page:
    """What the checks need from one page: rules (selector -> declarations, normal and reduced-motion), keyframes and the
    delays the script gives the elements."""

    def __init__(self, style, script=''):
        css = re.sub(r'/\*.*?\*/', '', style, flags=re.S)
        self.rules, self.reduced, self.keyframes = {}, {}, {}
        for prelude, body in blocks(css):
            if prelude.startswith('@keyframes'):
                self.keyframes[prelude.split()[1]] = {
                    stop.strip(): declarations(frame)
                    for stops, frame in blocks(body) for stop in stops.split(',')}
            elif prelude.startswith('@media'):
                target = self.reduced if 'prefers-reduced-motion' in prelude else None
                if target is not None:
                    for sel, inner in blocks(body):
                        target.setdefault(sel, {}).update(declarations(inner))
            else:
                self.rules.setdefault(prelude, {}).update(declarations(body))
        self.script = script

    def animated(self, rules):
        """{selector: [animation, ...]} of the rules that animate."""
        found = {}
        for sel, decl in rules.items():
            if 'animation' in decl:
                found[sel] = [parse_animation(v) for v in split_top(decl['animation'])]
        return found

    def effective(self, selector):
        """The animations an element of `selector` runs in the reduced-motion case (the override replaces the list)."""
        return self.animated(self.reduced).get(selector) or self.animated(self.rules)[selector]

    def delays_set_by_script(self):
        return bool(re.search(r'animationDelay|--d\b', self.script))

    def opacity_ends(self, name):
        frames = self.keyframes.get(name, {})
        first = next((frames[k] for k in ('0%', 'from') if k in frames), {})
        last = next((frames[k] for k in ('100%', 'to') if k in frames), {})
        return first.get('opacity'), last.get('opacity')

    def animates_opacity(self, name):
        return any('opacity' in f for f in self.keyframes.get(name, {}).values())


def check(page):
    """The list of problems of a Page (empty when it is right), each a short sentence that names the rule."""
    problems = []
    shown = page.animated(page.rules)
    for sel, animations in shown.items():
        owner = sel.split()[0]
        base = {}
        for rule_sel in (sel, '.p'):                        # the element's own rule, then the shared one
            for k, v in page.rules.get(rule_sel, {}).items():
                base.setdefault(k, v)
        if base.get('opacity') != '0' and sel != '.p':
            problems.append(f'{sel}: base opacity is {base.get("opacity", "1 (unset)")}, not 0, so it shows before its animation starts')
        for variant, lists in (('', animations), (' (reduced motion)', page.effective(sel))):
            delayed = page.delays_set_by_script() or any(a['delay'] not in (0.0, 0) for a in lists)
            for a in lists:
                if delayed and a['fill'] != 'both':
                    problems.append(f'{sel}{variant}: animation {a["name"]} waits for a delay with fill-mode {a["fill"]}, not both')
            fades = [a for a in lists if page.animates_opacity(a['name'])]
            if not fades:
                problems.append(f'{sel}{variant}: no animation of opacity, so it never goes back to invisible')
            for a in fades:
                first, last = page.opacity_ends(a['name'])
                if first != '0' or last != '0':
                    problems.append(f'{sel}{variant}: {a["name"]} runs opacity {first} to {last}, it must start and end at 0')
        # movement in whole pixels
        for a in animations:
            frames = page.keyframes.get(a['name'], {})
            text = ' '.join(v for f in frames.values() for k, v in f.items() if k in ('transform', 'translate'))
            if re.search(r'rotate|skew', text):
                problems.append(f'{sel}: {a["name"]} rotates or skews (anti-aliased pixels)')
            if re.search(r'scale\(\s*[^)]*\.\d', text):
                problems.append(f'{sel}: {a["name"]} scales by a fraction')
            for number in re.findall(r'(-?\d*\.\d+)px', text):
                problems.append(f'{sel}: {a["name"]} has a fractional pixel literal {number}px')
            if text and 'round(' not in text:
                if not a['timing'].startswith('steps('):
                    problems.append(f'{sel}: {a["name"]} moves without steps(), so it passes through sub-pixel positions')
                else:
                    steps = int(re.search(r'steps\(\s*(\d+)', a['timing']).group(1))
                    travel = [abs(int(n)) for n in re.findall(r'(-?\d+)px', text)]
                    if travel and max(travel) % steps:
                        problems.append(f'{sel}: {a["name"]} travels {max(travel)}px in {steps} steps (not whole pixels)')
            if text and 'round(' in text and a['timing'].replace(' ', '') != 'steps(1,end)':
                problems.append(f'{sel}: {a["name"]} snaps with round() but is not held with steps(1, end)')
    return problems


def split_page(html):
    style = re.search(r'<style>(.*?)</style>', html, re.S).group(1)
    script = ''.join(re.findall(r'<script>(.*?)</script>', html, re.S))
    return style, script


def longest_life(page, script):
    """Seconds: the largest delay the script gives times the count of elements, plus the longest duration."""
    life = 0.0
    for sel, animations in page.animated(page.rules).items():
        duration = max(a['duration'] for a in animations)
        step = re.search(r'\$\{i \* (\d+)\}ms', script)
        count = re.search(r"kind === 'palmas' \? (\d+)", script)
        delay = 0.0
        if sel == '.clap' and step and count:
            delay = (int(count.group(1)) - 1) * int(step.group(1)) / 1000
        life = max(life, delay + duration)
    return life


# ---------------------------------------------------------------------------------------------------- the tests
class ShippedPage(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.html = PAGE.read_text(encoding='utf-8')
        cls.style, cls.script = split_page(cls.html)
        cls.page = Page(cls.style, cls.script)

    def test_the_page_has_no_problems(self):
        self.assertEqual(check(self.page), [])

    def test_both_kinds_are_animated_and_delayed_ones_are_known(self):
        self.assertEqual(sorted(self.page.animated(self.page.rules)), ['.bit', '.clap'])
        self.assertTrue(self.page.delays_set_by_script(), 'the claps are staggered by the script; the delay rule must see it')

    def test_base_state_is_invisible(self):
        self.assertEqual(self.page.rules['.p'].get('opacity'), '0')

    def test_every_animation_fills_both_ways(self):
        for sel, animations in self.page.animated(self.page.rules).items():
            for a in animations:
                self.assertEqual(a['fill'], 'both', f'{sel} {a["name"]}')
        for sel, animations in self.page.animated(self.page.reduced).items():
            for a in animations:
                self.assertEqual(a['fill'], 'both', f'reduced {sel} {a["name"]}')

    def test_reduced_motion_still_ends_invisible_and_does_not_move(self):
        for sel in ('.clap', '.bit'):
            lists = self.page.effective(sel)
            self.assertEqual([a['name'] for a in lists], ['fade'], sel)
        self.assertNotIn('transform', ' '.join(self.page.reduced['.clap'].values()))

    def test_lives_less_than_the_overlay_does(self):
        text = SOCIAL.read_text(encoding='utf-8')
        removed_ms = int(re.search(r'setTimeout\([^;]*?,\s*(\d+)\)\s*;', text[text.index('const react'):]).group(1))
        life = longest_life(self.page, self.script)
        self.assertGreater(life, 1.0)
        self.assertLess(life * 1000, removed_ms, f'{life * 1000:.0f} ms of animation, the page is removed after {removed_ms} ms')

    def test_the_built_copy_is_the_source(self):
        dist = os.environ.get('KONCLUI_DIST')
        if not dist or not (Path(dist) / 'reactions' / 'index.html').exists():
            self.skipTest('KONCLUI_DIST not set (or no built reactions page)')
        self.assertEqual((Path(dist) / 'reactions' / 'index.html').read_bytes(), PAGE.read_bytes())


class CheckerSeesTheOldBug(unittest.TestCase):
    """The checker fails the page as it was, and a one-line change of the new page fails the check that names it."""

    def problems(self, style, script):
        return check(Page(style, script))

    def test_the_old_page_fails_n55(self):
        found = self.problems(OLD_STYLE, OLD_SCRIPT)
        self.assertTrue(any('.clap' in p and 'fill-mode forwards, not both' in p for p in found), found)
        self.assertTrue(any('.clap: base opacity is 1 (unset)' in p for p in found), found)

    def test_the_old_page_fails_the_pixel_rules(self):
        found = self.problems(OLD_STYLE, OLD_SCRIPT)
        self.assertTrue(any('.bit: burst rotates' in p for p in found), found)
        self.assertTrue(any('moves without steps()' in p for p in found), found)

    def variant(self, old, new):
        style, script = split_page(PAGE.read_text(encoding='utf-8'))
        self.assertIn(old, style, 'the variant needs text that is in the page')
        return self.problems(style.replace(old, new, 1), script)

    def test_a_fill_of_forwards_fails(self):
        found = self.variant('steps(27, end) var(--d) both', 'steps(27, end) var(--d) forwards')
        self.assertEqual(found, ['.clap: animation clap-rise waits for a delay with fill-mode forwards, not both'])

    def test_a_visible_base_fails(self):
        found = self.variant('opacity: 0; image-rendering', 'opacity: 1; image-rendering')
        self.assertTrue(all('base opacity is 1, not 0' in p for p in found) and len(found) == 2, found)

    def test_a_move_without_steps_fails(self):
        found = self.variant('steps(27, end)', 'linear')
        self.assertEqual(found, ['.clap: clap-rise moves without steps(), so it passes through sub-pixel positions'])

    def test_a_fade_that_does_not_end_at_zero_fails(self):
        found = self.variant('100% { opacity: 0; } }', '100% { opacity: .3; } }')
        self.assertTrue(any('must start and end at 0' in p for p in found), found)

    def test_a_fractional_step_fails(self):
        found = self.variant('translateY(-54px)', 'translateY(-55px)')
        self.assertTrue(any('not whole pixels' in p for p in found), found)

    def test_a_rotation_fails(self):
        found = self.variant('translateY(-54px); }', 'translateY(-54px) rotate(10deg); }')
        self.assertTrue(any('rotates' in p for p in found), found)


if __name__ == '__main__':
    unittest.main(verbosity=2)
