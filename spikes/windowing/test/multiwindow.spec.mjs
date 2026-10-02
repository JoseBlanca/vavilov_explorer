// Whether WebDriver can see and drive every window of the app, and see a
// change made in one window appear in another.

/** The handle of each window, by what its page shows. */
async function windowsByRole() {
  const roles = {};
  for (const handle of await browser.getWindowHandles()) {
    await browser.switchToWindow(handle);
    const role = await browser.execute(() =>
      document.querySelector("#control") ? "main" : (document.querySelector("#status")?.textContent ?? "").split(" ")[0],
    );
    roles[role] = handle;
  }
  return roles;
}

describe("several windows", () => {
  it("lists the three windows and switches to each", async () => {
    const roles = await windowsByRole();
    console.log("windows found:", JSON.stringify(roles));
    expect(Object.keys(roles).sort()).toEqual(["main", "view-1", "view-2"]);
  });

  it("shows in view-2 a hover set from view-1", async () => {
    const roles = await windowsByRole();
    await browser.switchToWindow(roles["view-1"]);
    await browser.execute(() => window.__TAURI_INTERNALS__.invoke("set_hover", { index: 4242, t0: Date.now() }));
    await browser.switchToWindow(roles["view-2"]);
    await browser.waitUntil(
      async () => (await browser.execute(() => document.querySelector("#status").textContent)).includes("hover 4242"),
      { timeout: 5000, timeoutMsg: "view-2 never showed hover 4242" },
    );
  });

  it("picks the point under the pointer in view-2 and shows its hover in view-1", async () => {
    const roles = await windowsByRole();
    await browser.switchToWindow(roles["view-2"]);
    await browser.execute(() => {
      const canvas = document.querySelector("canvas");
      const r = canvas.getBoundingClientRect();
      const at = { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, bubbles: true };
      canvas.dispatchEvent(new PointerEvent("pointermove", at));
    });
    // The test before left the hover at 4242; a point picked at the
    // centre is another one, and a failed pick sets the hover to -1.
    await browser.switchToWindow(roles["view-1"]);
    await browser.waitUntil(
      async () => {
        const status = await browser.execute(() => document.querySelector("#status").textContent);
        const hover = Number(status.match(/hover (-?\d+)/)[1]);
        return hover >= 0 && hover !== 4242;
      },
      { timeout: 5000, timeoutMsg: "view-1 never showed a hover picked in view-2" },
    );
  });

  it("brings a minimized window up to date when it is restored", async () => {
    const roles = await windowsByRole();
    const status = async (role) => {
      await browser.switchToWindow(roles[role]);
      return browser.execute(() => document.querySelector("#status").textContent);
    };
    await browser.switchToWindow(roles["view-1"]);
    await browser.execute(() => window.__TAURI_INTERNALS__.invoke("set_minimized", { label: "view-2", minimized: true }));
    await browser.switchToWindow(roles["view-2"]);
    await browser.waitUntil(() => browser.execute(() => document.hidden), {
      timeout: 5000,
      timeoutMsg: "view-2 was never hidden",
    });
    // 90 s hidden, with a hover every 100 ms sent from view-1, in one
    // script, which WebDriver otherwise stops after 30 s.
    await browser.setTimeout({ script: 120000 });
    await browser.switchToWindow(roles["view-1"]);
    const last = await browser.execute(async () => {
      let index = 0;
      for (let k = 0; k < 900; k++) {
        index = (k * 37) % 50000;
        await window.__TAURI_INTERNALS__.invoke("set_hover", { index, t0: Date.now() });
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      return index;
    });
    await browser.execute(() => window.__TAURI_INTERNALS__.invoke("set_minimized", { label: "view-2", minimized: false }));
    const expected = (await status("view-1")).match(/revision (\d+)/)[1];
    await browser.waitUntil(async () => (await status("view-2")).includes(`revision ${expected}  hover ${last}`), {
      timeout: 5000,
      timeoutMsg: `view-2 did not show revision ${expected} and hover ${last} after it was restored`,
    });
    console.log("after restoring:", await status("view-2"));
  }).timeout(150000);
});
