// Context menus (Herdr's items). Opened as a popup with
// props { tab: "pane" | "tab" | "space" | "global", target }.
// ↑/↓ move, Enter runs, Esc closes. An item is [label, command, args];
// a command "worktree" opens the worktree dialog instead.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { run, props, closeOverlay, openOverlay, theme, keys, terminals, spaces, panes, exec, home, appHome, notify, window, shared, setShared } from "herdr";

// Where a space is now: its first terminal's live folder, else where it was made.
function place(s) {
  const tabs = new Set((s.tabs ?? []).map((c) => c.id));
  return panes().find((p) => tabs.has(p.tab) && p.cwd)?.cwd || s.folder;
}

// A space's checkout: "main" (a repo's own), "linked" (a worktree), or null.
async function checkout(folder, on) {
  const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd: folder, on });
  const common = await exec("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: folder, on });
  if (top.code !== 0 || common.code !== 0) return null;
  return common.stdout.trim() === `${top.stdout.trim()}/.git` ? "main" : "linked";
}

function items(p, git, pinnedId) {
  p = p ?? {};
  const tg = p.target ?? {};
  switch (p.tab) {
    case "pane": {
      // A kept sub-agent can go back under its parent, still running.
      const all = terminals();
      const term = all.find((t) => t.address === tg.terminal);
      const parent = term?.parent && all.find((t) => t.address === term.parent);
      // Once they go to the program, Shift+right-click still opens this menu.
      const toProgram = term?.labels?.["herdr.right-click"] === "program";
      return [
        ["Split right", "pane.split", { direction: "right", pane: tg.pane }],
        ["Split down", "pane.split", { direction: "down", pane: tg.pane }],
        ["Zoom", "pane.zoom", { pane: tg.pane }],
        ...(term
          ? [
              toProgram
                ? ["Use Herdr right-click menu", "terminal.right_click", { terminal: term.address, to: "menu" }]
                : ["Send right-clicks to pane", "terminal.right_click", { terminal: term.address, to: "program" }],
            ]
          : []),
        ...(parent ? [[`Send back to ${parent.name || parent.address}`, "terminal.park", { terminal: term.address }]] : []),
        ["Close pane", "pane.close", { pane: tg.pane }],
      ];
    }
    case "tab":
      return [
        ["Rename", "tab.rename", { id: tg.id }],
        ["New tab", "tab.new", { space: tg.space }],
        ["Close", "tab.close", { id: tg.id }],
      ];
    case "space": {
      const pinItems = pinnedId === tg.id
        ? [["Unpin this space", "space.unpin", { id: tg.id }]]
        : pinnedId
          ? []
          : [["Pin this space", "space.pin", { id: tg.id }]];
      return [
        ["Rename", "space.rename", { id: tg.id }],
        ...(git ? [["New worktree", "worktree", { space: tg.id, action: "new" }], ["Open worktree", "worktree", { space: tg.id, action: "open" }]] : []),
        ...(git === "linked" ? [["Remove worktree", "worktree", { space: tg.id, action: "remove" }]] : []),
        ...pinItems,
        ["Open in new window", "window.new", { id: tg.id }],
        ["Close", "space.close", { id: tg.id }],
      ];
    }
    default:
      return [
        ["New space", "space.new", {}],
        ["Keybinds", "app.help", {}],
        ["Theme: graphite", "app.theme", { name: "graphite" }],
        ["Theme: ink", "app.theme", { name: "ink" }],
        ["Theme: moss", "app.theme", { name: "moss" }],
        ["Theme: atom one dark", "app.theme", { name: "atom-one-dark" }],
      ];
  }
}

function menuIcon(command) {
  const name = command === "space.pin" ? "pin" : command === "space.unpin" ? "pin-off" : command.endsWith(".close") ? "x" : command.endsWith(".rename") ? "square-pen" : command.endsWith(".new") ? "plus" : command === "worktree" ? "git-branch" : command === "app.help" ? "terminal" : command === "app.theme" ? "settings" : command === "pane.split" ? "panel-right" : command === "pane.zoom" ? "square" : "terminal";
  return `mods/workspace-chrome/${name}.svg`;
}

function shellQuote(value) {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function powershellQuote(value) {
  return `'${value.replace(/'/g, "''")}'`;
}

function openWindow(spaceId, cx) {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const target = powershellQuote(spaceId);
  let command;
  let args;
  if (window().platform === "windows") {
    const sourceHome = powershellQuote(appHome());
    command = "powershell.exe";
    args = [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `$ErrorActionPreference = 'Stop'; $sourceHome = ${sourceHome}; $newHome = Join-Path $env:LOCALAPPDATA ${powershellQuote(`Herdr\\windows\\${id}`)}; New-Item -ItemType Directory -Force -Path (Join-Path $newHome 'layouts'), (Join-Path $newHome 'mods') | Out-Null; Copy-Item -LiteralPath (Join-Path $sourceHome 'layouts\\main-window.json') -Destination (Join-Path $newHome 'layouts') -Force; foreach ($mod in @('focus-window', 'focus-menu', 'focus-agents')) { Copy-Item -LiteralPath (Join-Path $sourceHome (Join-Path 'mods' $mod)) -Destination (Join-Path $newHome 'mods') -Recurse -Force }; foreach ($file in @('settings.json', 'keys.json', 'programs.json', 'shared.json')) { $path = Join-Path $sourceHome $file; if (Test-Path -LiteralPath $path) { Copy-Item -LiteralPath $path -Destination $newHome -Force } }; $sharedPath = Join-Path $newHome 'shared.json'; $shared = if (Test-Path -LiteralPath $sharedPath) { Get-Content -LiteralPath $sharedPath -Raw | ConvertFrom-Json } else { [pscustomobject]@{} }; $shared | Add-Member -MemberType NoteProperty -Name 'space.pin' -Value ${target} -Force; [System.IO.File]::WriteAllText($sharedPath, ($shared | ConvertTo-Json -Depth 100), [System.Text.UTF8Encoding]::new($false)); $env:HERDR_APP_HOME = $newHome; $app = Start-Process -FilePath 'herdr-app' -PassThru; for ($i = 0; $i -lt 100; $i++) { if ($app.HasExited) { throw 'Herdr exited before its new window was ready' }; & herdr-app status 2>$null; if ($LASTEXITCODE -eq 0) { & herdr-app do layout.switch --name main-window; if ($LASTEXITCODE -ne 0) { throw 'Could not activate the copied layout' }; for ($attempt = 0; $attempt -lt 100; $attempt++) { if ($app.HasExited) { throw 'Herdr exited before the selected space was ready' }; $listingText = & herdr-app ls 2>$null; if ($LASTEXITCODE -eq 0) { $listing = $listingText | ConvertFrom-Json; $selectedSpace = $listing.spaces | Where-Object { $_.id -eq ${target} }; $activeTab = $selectedSpace.tabs | Where-Object { $_.active }; if ($activeTab) { & herdr-app do space.select --id ${target}; if ($LASTEXITCODE -ne 0) { throw 'Could not select the space in the new window' }; $terminalPane = $activeTab.terminals | Select-Object -First 1 -ExpandProperty pane; if ($terminalPane) { & herdr-app do pane.focus --pane $terminalPane; if ($LASTEXITCODE -ne 0) { throw 'Could not focus the selected space pane' } }; $status = & herdr-app status | ConvertFrom-Json; if ($status.space -eq ${target} -and (-not $terminalPane -or $status.focused_pane -eq $terminalPane)) { exit 0 } } }; Start-Sleep -Milliseconds 250 }; throw 'Timed out waiting for the new window to select and focus the space' }; Start-Sleep -Milliseconds 250 }; throw 'Timed out waiting for the new Herdr window'`,
    ];
  } else if (window().platform === "macos") {
    const newAppHome = `${home()}/.local/share/herdr-app/windows/${id}`;
    const sourceHome = shellQuote(appHome());
    command = "sh";
    args = [
      "-c",
      `source_home=${sourceHome}; new_home=${shellQuote(newAppHome)}; mkdir -p "$new_home/layouts" "$new_home/mods" && cp "$source_home/layouts/main-window.json" "$new_home/layouts/" && cp -R "$source_home/mods/focus-window" "$source_home/mods/focus-menu" "$source_home/mods/focus-agents" "$new_home/mods/" || exit 1
for file in settings.json keys.json programs.json shared.json; do [ ! -f "$source_home/$file" ] || cp "$source_home/$file" "$new_home/" || exit 1; done
python3 -c 'import json,sys; p,space=sys.argv[1:]; f=open(p,encoding="utf-8"); data=json.load(f); f.close(); data["space.pin"]=space; f=open(p,"w",encoding="utf-8"); json.dump(data,f,ensure_ascii=False); f.close()' "$new_home/shared.json" ${shellQuote(spaceId)} || exit 1
export HERDR_APP_HOME="$new_home"
open -n -a Herdr --env HERDR_APP_HOME="$new_home" || exit 1
for i in $(seq 1 100); do
  if herdr-app status >/dev/null 2>&1; then
    herdr-app do layout.switch --name main-window || exit 1
    for attempt in $(seq 1 100); do
      listing=$(herdr-app ls 2>/dev/null) || { sleep 0.25; continue; }
      ready=$(printf '%s' "$listing" | python3 -c 'import json,sys; spaces=json.load(sys.stdin)["spaces"]; space=next((s for s in spaces if s["id"]==sys.argv[1]),None); print("1" if space and any(t.get("active") for t in space.get("tabs",[])) else "0")' ${shellQuote(spaceId)}) || exit 1
      if [ "$ready" = 1 ]; then
        pane=$(printf '%s' "$listing" | python3 -c 'import json,sys; spaces=json.load(sys.stdin)["spaces"]; space=next(s for s in spaces if s["id"]==sys.argv[1]); tab=next(t for t in space["tabs"] if t.get("active")); print(next(iter(tab.get("terminals",[])),{}).get("pane",""))' ${shellQuote(spaceId)}) || exit 1
        herdr-app do space.select --id ${shellQuote(spaceId)} || exit 1
        [ -z "$pane" ] || herdr-app do pane.focus --pane "$pane" || exit 1
        status=$(herdr-app status) || exit 1
        printf '%s' "$status" | python3 -c 'import json,sys; d=json.load(sys.stdin); expected=sys.argv[1:]; sys.exit(0 if d.get("space")==expected[0] and (not expected[1] or d.get("focused_pane")==expected[1]) else 1)' ${shellQuote(spaceId)} "$pane" && exit 0
      fi
      sleep 0.25
    done
    echo "Timed out waiting for the new window to select and focus the space" >&2
    exit 1
  fi
  sleep 0.25
done
echo "Timed out waiting for the new Herdr window" >&2
exit 1`,
    ];
  } else {
    const newAppHome = `${home()}/.local/share/herdr-app/windows/${id}`;
    const sourceHome = shellQuote(appHome());
    command = "sh";
    args = [
      "-c",
      `source_home=${sourceHome}; new_home=${shellQuote(newAppHome)}; mkdir -p "$new_home/layouts" "$new_home/mods" && cp "$source_home/layouts/main-window.json" "$new_home/layouts/" && cp -R "$source_home/mods/focus-window" "$source_home/mods/focus-menu" "$source_home/mods/focus-agents" "$new_home/mods/" || exit 1
for file in settings.json keys.json programs.json shared.json; do [ ! -f "$source_home/$file" ] || cp "$source_home/$file" "$new_home/" || exit 1; done
python3 -c 'import json,sys; p,space=sys.argv[1:]; f=open(p,encoding="utf-8"); data=json.load(f); f.close(); data["space.pin"]=space; f=open(p,"w",encoding="utf-8"); json.dump(data,f,ensure_ascii=False); f.close()' "$new_home/shared.json" ${shellQuote(spaceId)} || exit 1
export HERDR_APP_HOME="$new_home"
herdr-app >/dev/null 2>&1 & app=$!
for i in $(seq 1 100); do
  kill -0 "$app" 2>/dev/null || { echo "Herdr exited before its new window was ready" >&2; exit 1; }
  if herdr-app status >/dev/null 2>&1; then
    herdr-app do layout.switch --name main-window || exit 1
    for attempt in $(seq 1 100); do
      kill -0 "$app" 2>/dev/null || { echo "Herdr exited before the selected space was ready" >&2; exit 1; }
      listing=$(herdr-app ls 2>/dev/null) || { sleep 0.25; continue; }
      ready=$(printf '%s' "$listing" | python3 -c 'import json,sys; spaces=json.load(sys.stdin)["spaces"]; space=next((s for s in spaces if s["id"]==sys.argv[1]),None); print("1" if space and any(t.get("active") for t in space.get("tabs",[])) else "0")' ${shellQuote(spaceId)}) || exit 1
      if [ "$ready" = 1 ]; then
        pane=$(printf '%s' "$listing" | python3 -c 'import json,sys; spaces=json.load(sys.stdin)["spaces"]; space=next(s for s in spaces if s["id"]==sys.argv[1]); tab=next(t for t in space["tabs"] if t.get("active")); print(next(iter(tab.get("terminals",[])),{}).get("pane",""))' ${shellQuote(spaceId)}) || exit 1
        herdr-app do space.select --id ${shellQuote(spaceId)} || exit 1
        [ -z "$pane" ] || herdr-app do pane.focus --pane "$pane" || exit 1
        status=$(herdr-app status) || exit 1
        printf '%s' "$status" | python3 -c 'import json,sys; d=json.load(sys.stdin); expected=sys.argv[1:]; sys.exit(0 if d.get("space")==expected[0] and (not expected[1] or d.get("focused_pane")==expected[1]) else 1)' ${shellQuote(spaceId)} "$pane" && exit 0
      fi
      sleep 0.25
    done
    echo "Timed out waiting for the new window to select and focus the space" >&2
    exit 1
  fi
  sleep 0.25
done
echo "Timed out waiting for the new Herdr window" >&2
exit 1`,
    ];
  }
  cx.spawn(async () => {
    try {
      const result = await exec(command, args);
      if (result.code !== 0) throw new Error(result.stderr.trim() || `Command exited with code ${result.code}`);
    } catch (error) {
      notify({ title: "Couldn't open a new window", body: String(error), level: "error" });
    }
  });
}

// The key bound to a command, for the hint on the right.
function shortcut(name, args) {
  // `pane.split:right` binds pane.split with { direction: "right" }.
  const value = args && Object.values(args)[0];
  const k = keys().find((b) => b.section === "global" && (b.action === name || b.action === `${name}:${value}`));
  return k ? k.keys : "";
}

export default class Menu extends View {
  init(_props, cx) {
    this.at = 0;
    this.git = null;
    this.handle = cx.focus_handle();
    this.handle.focus();
    const p = props();
    const space = p?.tab === "space" && spaces().find((s) => s.id === p.target?.id);
    const folder = space && place(space);
    if (folder)
      cx.spawn(async (cx) => {
        this.git = await checkout(folder, space.machine).catch(() => null);
        cx.notify();
      });
  }

  choose(i, cx) {
    const value = shared("space.pin");
    const pinnedId = typeof value === "string" ? value : null;
    const it = items(props(), this.git, pinnedId)[i];
    if (!it) return;
    closeOverlay(props()?.overlay);
    if (it[1] === "worktree") openOverlay({ mod: "worktree", kind: "dialog", ...(it[2].action === "open" ? { width: 560, height: 480 } : { width: 440, height: 260 }), props: it[2] });
    else if (it[1] === "space.pin") {
      setShared("space.pin", it[2].id);
      run("space.select", { id: it[2].id });
    } else if (it[1] === "space.unpin") setShared("space.pin", null);
    else if (it[1] === "window.new") openWindow(it[2].id, cx);
    else run(it[1], it[2]);
  }

  render(cx) {
    const t = theme();
    const value = shared("space.pin");
    const pinnedId = typeof value === "string" ? value : null;
    const list = items(props(), this.git, pinnedId);
    return v_flex()
      .id("menu")
      .track_focus(this.handle)
      .w_full()
      .min_h(0)
      .p(5)
      .bg(t.popover)
      .text_size(12.8)
      .on_key_down((e, cx) => {
        if (e.key === "down") this.at = (this.at + 1) % list.length;
        else if (e.key === "up") this.at = (this.at + list.length - 1) % list.length;
        else if (e.key === "enter") this.choose(this.at, cx);
        else if (e.key === "escape") closeOverlay(props().overlay);
        else return;
        cx.notify();
      })
      .children(
        list.map((it, i) =>
          v_flex()
            .when(i > 0 && (it[1].endsWith(".close") || it[1] === "app.help" || (it[1] === "app.theme" && list[i - 1][1] !== "app.theme")), el => el.child(div().mx(7).my(4).h(1).bg(t.border)))
            .child(h_flex()
            .id(`mi-${i}`)
            .h(31)
            .px(8)
            .gap(9)
            .rounded(7)
            .items_center()
            .justify_between()
            .text_color(t.foreground)
            .when(i === this.at, (el) => el.bg(t.selected))
            .hover((s) => s.bg(t.hover))
            .on_click((_e, cx) => this.choose(i, cx))
            .child(svg(menuIcon(it[1])).size(14).flex_none().text_color(t.muted))
            .child(div().flex_1().child(it[0]))
            .child(div().text_size(11).text_color(t.dim).child(shortcut(it[1], it[2])))),
        ),
      );
  }
}
