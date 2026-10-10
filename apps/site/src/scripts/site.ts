// Copy buttons, the item-017 run demo, stamps, and the masthead clock.
// Everything is fully printed without this script.

const motion = document.documentElement.classList.contains("motion");
const lcd = document.querySelector<HTMLElement>("[data-lcd]");
const lcdIdle = lcd?.textContent ?? "";

function setLcd(text: string, ms = 2400) {
    if (!lcd) return;
    lcd.textContent = text;
    window.setTimeout(() => (lcd.textContent = lcdIdle), ms);
}

for (const button of document.querySelectorAll<HTMLButtonElement>(
    "[data-copy]",
)) {
    button.addEventListener("click", async () => {
        const text = button.dataset.copy ?? "";
        try {
            await navigator.clipboard.writeText(text);
            button.dataset.copied = "";
            setLcd("Copied · paste it in your terminal");
        } catch {
            setLcd("Copy blocked · select the command instead", 3600);
            return;
        }
        window.setTimeout(() => delete button.dataset.copied, 2000);
    });
}

const clock = document.querySelector<HTMLElement>("[data-clock]");
if (clock) {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    clock.textContent = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(
        now.getDate(),
    )} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

function onceVisible(el: Element, threshold: number, run: () => void) {
    const observer = new IntersectionObserver(
        (entries) => {
            if (entries.some((entry) => entry.isIntersecting)) {
                observer.disconnect();
                run();
            }
        },
        { threshold },
    );
    observer.observe(el);
}

const run = document.querySelector<HTMLElement>("[data-run]");
const replay = run?.querySelector<HTMLButtonElement>("[data-replay]");
const blocks = run ? [...run.querySelectorAll<HTMLElement>(".resp")] : [];
let timers: number[] = [];

function playRun() {
    if (!run) return;
    timers.forEach((t) => window.clearTimeout(t));
    timers = [];
    run.classList.add("armed");
    const start = performance.now();
    let frame = 0;

    for (const block of blocks) {
        block.classList.remove("printed");
        const latency = Number(block.dataset.latency);
        const elapsed = block.querySelector<HTMLElement>("[data-elapsed]");
        timers.push(
            window.setTimeout(() => {
                block.classList.add("printed");
                if (elapsed) elapsed.textContent = `${latency} ms`;
            }, latency),
        );
    }

    const tick = () => {
        const ms = performance.now() - start;
        let waiting = false;
        for (const block of blocks) {
            if (block.classList.contains("printed")) continue;
            waiting = true;
            const elapsed = block.querySelector<HTMLElement>("[data-elapsed]");
            if (elapsed) elapsed.textContent = `${(ms / 1000).toFixed(2)} s`;
        }
        if (waiting) frame = requestAnimationFrame(tick);
        else cancelAnimationFrame(frame);
    };
    frame = requestAnimationFrame(tick);
}

if (run && motion && blocks.length) {
    run.classList.add("armed");
    onceVisible(blocks[0], 0.25, () => {
        window.setTimeout(playRun, 250);
    });
    if (replay) {
        replay.hidden = false;
        replay.addEventListener("click", playRun);
    }
}

const board = document.querySelector<HTMLElement>("[data-board]");
if (board && motion) {
    board.classList.add("armed");
    onceVisible(board, 0.5, () => {
        board.classList.remove("armed");
        board.classList.add("stamped");
    });
}
