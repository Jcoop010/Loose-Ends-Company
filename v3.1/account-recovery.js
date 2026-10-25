/* Account recovery uses the existing Supabase client and never stores passwords. */
(function () {
  'use strict';
  var S = window.LESupabase, recovery = false;
  if (!S) return;
  function dialog(title, body) {
    var old = document.getElementById('le-auth-modal');
    if (old) old.remove();
    var modal = document.createElement('div');
    modal.id = 'le-auth-modal'; modal.className = 'le-auth-modal';
    modal.innerHTML = '<div class="le-auth-card"><button type="button" class="le-auth-close" aria-label="Close dialog">×</button><div class="eyebrow">LOOSE ENDS</div><h2>'+title+'</h2>'+body+'<p class="le-auth-note" id="le-recovery-note" role="status" aria-live="polite"></p></div>';
    document.body.appendChild(modal);
    modal.querySelector('.le-auth-close').onclick = function () { modal.remove(); };
    return modal;
  }
  function openRequest() {
    var modal = dialog('Reset your password', '<p>Enter your account email to request a secure reset link.</p><form id="le-recovery-request"><label class="le-auth-field" for="le-recovery-email">Email</label><input class="le-auth-input" id="le-recovery-email" name="email" type="email" autocomplete="email" required><div class="le-auth-actions"><button class="le-auth-btn le-auth-primary" type="submit">Send reset link</button></div></form>');
    var form = modal.querySelector('form'), busy = false;
    form.onsubmit = async function (event) {
      event.preventDefault(); if (busy || !form.reportValidity()) return;
      busy = true; var submit = form.querySelector('button'), note = modal.querySelector('[role="status"]'); submit.disabled = true;
      note.textContent = 'Requesting reset link…';
      try {
        var result = await S.auth.resetPasswordForEmail(form.elements.email.value.trim(), {redirectTo: window.location.origin+'/dashboard'});
        if (result.error) throw result.error;
        note.textContent = 'If an account exists for this email, a reset link has been requested. Check your inbox and spam folder.';
      } catch (error) { note.textContent = 'Unable to request a reset link. Please wait a moment and try again.'; }
      finally { busy = false; submit.disabled = false; }
    };
  }
  function openUpdate() {
    var modal = dialog('Choose a new password', '<p>Use a unique password with at least 12 characters.</p><form id="le-recovery-update"><label class="le-auth-field" for="le-new-password">New password</label><input class="le-auth-input" id="le-new-password" name="password" type="password" autocomplete="new-password" required minlength="12" maxlength="1024"><label class="le-auth-field" for="le-confirm-password">Confirm password</label><input class="le-auth-input" id="le-confirm-password" name="confirm" type="password" autocomplete="new-password" required><div class="le-auth-actions"><button class="le-auth-btn le-auth-primary" type="submit">Save new password</button></div></form>');
    var form = modal.querySelector('form'), busy = false;
    form.onsubmit = async function (event) {
      event.preventDefault(); if (busy || !form.reportValidity()) return;
      busy = true; var submit = form.querySelector('button'), note = modal.querySelector('[role="status"]'); submit.disabled = true;
      try {
        if (!recovery) throw Error('Open a valid recovery link before resetting your password.');
        if (form.elements.password.value !== form.elements.confirm.value) throw Error('Passwords do not match.');
        if (!window.LEPasswordSecurity) throw Error('Password safety check is unavailable. Reload and try again.');
        await window.LEPasswordSecurity.check(form.elements.password.value);
        var result = await S.auth.updateUser({password: form.elements.password.value});
        if (result.error) throw Error('Password could not be updated. Request a new recovery link and try again.');
        recovery = false; form.reset(); form.hidden = true;
        note.textContent = 'Password updated. Signing out so you can sign in with your new password…';
        var logout = await S.auth.signOut();
        if (logout.error) { note.textContent = 'Password updated. Sign out from Account before signing in again.'; return; }
        modal.remove(); window.LELive.openAuth();
      } catch (error) { note.textContent = error.message || 'Password could not be updated.'; }
      finally { busy = false; submit.disabled = false; }
    };
  }
  S.auth.onAuthStateChange(function (event) {
    if (event === 'PASSWORD_RECOVERY') { recovery = true; setTimeout(openUpdate, 0); }
    if (event === 'SIGNED_OUT') recovery = false;
  });
  window.LEAccountRecovery = {openRequest: openRequest};
})();
