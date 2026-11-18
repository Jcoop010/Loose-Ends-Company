/* Read-only browser acceptance: real React DOM rendering and workspace navigation; zero record mutations. */
(function () {
  'use strict';
  const frame = document.getElementById('app');
  const out = document.getElementById('results');
  const status = document.getElementById('status');
  const run = document.getElementById('run');
  const exportButton = document.getElementById('export');
  exportButton.disabled = true;

  const sections = [
    { key: 'command', desktopLabel: 'Command Center', mobileLabel: 'Command' },
    { key: 'pipeline', desktopLabel: 'Pipeline & Quotes', mobileLabel: 'Pipeline' },
    { key: 'dispatch', desktopLabel: 'Dispatch & Jobs', mobileLabel: 'Dispatch' },
    { key: 'inventory', desktopLabel: 'Inventory & POs', mobileLabel: 'Inventory' },
    { key: 'autopilot', desktopLabel: 'Autopilot & Billing', mobileLabel: 'Autopilot' },
  ];

  const results = [];
  let running = false;
  let completed = false;

  function visible(el) {
    if (!el) return false;
    const s = el.ownerDocument.defaultView.getComputedStyle(el);
    return s.visibility !== 'hidden' && s.display !== 'none' && el.getClientRects().length > 0;
  }

  async function until(fn, label) {
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      if (fn()) return;
      await new Promise(r => setTimeout(r, 80));
    }
    throw new Error('Timed out: ' + label);
  }

  function resize(width) {
    frame.width = String(width);
    document.getElementById('width').value = String(width);
  }

  function record(width, view, name, ok, details) {
    results.push({
      width,
      view,
      check: name,
      passed: !!ok,
      ...(details ? { details } : {}),
    });
    out.textContent = JSON.stringify(
      {
        passed: results.filter(x => x.passed).length,
        failed: results.filter(x => !x.passed).length,
        results,
      },
      null,
      2,
    );
  }

  async function navigate(section, width) {
    const d = frame.contentDocument;
    if (width < 768) {
      const mobileNav = d.querySelector('nav[aria-label="Mobile workspace navigation"]');
      const btn = [...(mobileNav?.querySelectorAll('button') || [])].find(b =>
        b.textContent.trim().includes(section.mobileLabel),
      );
      if (!btn) throw new Error('Mobile workspace tab missing: ' + section.mobileLabel);
      btn.click();
    } else {
      const rail = d.querySelector('aside[aria-label="Primary workspace navigation"]');
      const btn = [...(rail?.querySelectorAll('button') || [])].find(b =>
        b.textContent.trim().includes(section.desktopLabel),
      );
      if (!btn) throw new Error('Desktop workspace link missing: ' + section.desktopLabel);
      btn.click();
    }
    await until(() => {
      const heading = d.querySelector('header h1');
      return heading && heading.textContent.trim() === section.desktopLabel;
    }, 'navigate ' + section.key);
    await new Promise(r => setTimeout(r, 160));
  }

  function audit(width, view) {
    const d = frame.contentDocument;
    const root = d.documentElement;
    const main = d.getElementById('main-workspace-content') || d.body;

    record(width, view, 'No document overflow', root.scrollWidth <= root.clientWidth + 2, {
      scrollWidth: root.scrollWidth,
      clientWidth: root.clientWidth,
    });
    record(width, view, 'No unexpected modal overlay', !d.querySelector('[role="dialog"]'));

    const controls = [
      ...main.querySelectorAll('input:not([type=hidden]),select,textarea'),
    ].filter(visible);
    const unnamed = controls.filter(
      el =>
        !el.getAttribute('aria-label') &&
        !el.getAttribute('aria-labelledby') &&
        !(el.labels && el.labels.length) &&
        !el.getAttribute('title'),
    );
    record(width, view, 'Form controls have labels', unnamed.length === 0, {
      unnamed: unnamed.map(el => el.id || el.name || el.tagName),
    });

    const ids = [...d.querySelectorAll('[id]')].map(el => el.id).filter(Boolean);
    const duplicates = ids.filter((id, i) => ids.indexOf(id) !== i);
    record(width, view, 'No duplicate element IDs', duplicates.length === 0, {
      duplicates: [...new Set(duplicates)].slice(0, 15),
    });

    const images = [...main.querySelectorAll('img')].filter(visible);
    const missingAlt = images.filter(el => !el.hasAttribute('alt'));
    record(width, view, 'Images have alt attributes', missingAlt.length === 0, {
      missing: missingAlt.map(el => el.src).slice(0, 10),
    });

    const emptyButtons = [...main.querySelectorAll('button')]
      .filter(visible)
      .filter(
        el =>
          !el.textContent.trim() &&
          !el.getAttribute('aria-label') &&
          !el.getAttribute('aria-labelledby') &&
          !el.getAttribute('title'),
      );
    record(width, view, 'Buttons have accessible names', emptyButtons.length === 0, {
      unnamed: emptyButtons.map(el => el.id || el.className).slice(0, 15),
    });

    if (width < 768) {
      const mobileNav = d.querySelector('nav[aria-label="Mobile workspace navigation"]');
      record(width, view, 'Mobile navigation visible', visible(mobileNav));
      const buttons = [...main.querySelectorAll('button')].filter(visible);
      const small = buttons.filter(el => el.getBoundingClientRect().height < 43);
      record(width, view, 'Touch target height', small.length === 0, {
        small: small.map(el => el.textContent.trim()).slice(0, 15),
      });
    }
  }

  exportButton.onclick = function () {
    if (!completed || !results.length) {
      status.textContent = 'Run the acceptance checks before exporting a report.';
      return;
    }
    const report = {
      generatedAt: new Date().toISOString(),
      app: 'Loose Ends OS',
      type: 'Structural viewport acceptance - not device certification',
      passed: results.filter(x => x.passed).length,
      failed: results.filter(x => !x.passed).length,
      results,
    };
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'loose-ends-acceptance.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  document.getElementById('resize').onclick = () =>
    resize(Number(document.getElementById('width').value));

  run.onclick = async function () {
    if (running) return;
    running = true;
    completed = false;
    exportButton.disabled = true;
    run.disabled = true;
    results.length = 0;
    out.textContent = 'Checks running…';
    try {
      await until(
        () => frame.contentDocument?.getElementById('main-workspace-content'),
        'authenticated workspace shell',
      );
      for (const width of [375, 390, 768, 1366]) {
        resize(width);
        status.textContent = 'Checking ' + width + 'px';
        await new Promise(r => setTimeout(r, 120));
        for (const section of sections) {
          try {
            await navigate(section, width);
            audit(width, section.key);
          } catch (e) {
            record(width, section.key, 'Navigation completes', false, { error: e.message });
          }
        }
      }
      completed = true;
      exportButton.disabled = results.length === 0;
      status.textContent =
        'Finished: ' +
        results.filter(x => !x.passed).length +
        ' failed checks. Results contain structural evidence only.';
    } catch (e) {
      status.textContent = 'Acceptance not completed: ' + e.message;
      out.textContent = JSON.stringify(
        { status: 'blocked', reason: e.message, results },
        null,
        2,
      );
      exportButton.disabled = true;
    } finally {
      running = false;
      run.disabled = false;
    }
  };
})();
