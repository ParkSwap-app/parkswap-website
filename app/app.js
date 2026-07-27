(() => {
  const API = "/api";
  const state = {
    token: localStorage.getItem("parkswap_token") || "",
    user: safeParse(localStorage.getItem("parkswap_user")) || null,
    vehicle: safeParse(localStorage.getItem("parkswap_vehicle")) || null,
    coords: null,
    mode: Number(localStorage.getItem("parkswap_mode")) || 0,
    spots: [],
    selectedSpot: null,
    map: null,
    userMarker: null,
    spotMarkers: [],
    installPrompt: null,
    refreshTimer: null,
    socialConfig: null,
    googleNonce: "",
    socialBusy: false,
  };

  const $ = (id) => document.getElementById(id);
  const authView = $("authView");
  const mainView = $("mainView");
  const authMessage = $("authMessage");
  const vehicleModal = $("vehicleModal");
  const spotModal = $("spotModal");

  function safeParse(value) { try { return value ? JSON.parse(value) : null; } catch { return null; } }
  function deviceId() {
    let id = localStorage.getItem("parkswap_device_id");
    if (!id) { id = crypto.randomUUID ? crypto.randomUUID() : `web-${Date.now()}-${Math.random().toString(16).slice(2)}`; localStorage.setItem("parkswap_device_id", id); }
    return id;
  }
  function headers(withAuth = true) {
    const value = {
      Accept: "application/json",
      "Device-Id": deviceId(),
      "Device-Type": "3",
      Timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York",
      Language: "en",
    };
    if (withAuth && state.token) value.Authorization = `Bearer ${state.token}`;
    return value;
  }
  async function api(path, { method = "GET", data = null, auth = true } = {}) {
    const options = { method, headers: headers(auth), cache: "no-store" };
    if (data) {
      const body = new FormData();
      Object.entries(data).forEach(([key, value]) => body.append(key, value == null ? "" : String(value)));
      options.body = body;
    }
    let response;
    try { response = await fetch(`${API}${path}`, options); }
    catch { throw new Error("ParkSwap could not reach the service. Check your connection and try again."); }
    let payload;
    try { payload = await response.json(); } catch { throw new Error("ParkSwap received an unexpected response. Please try again."); }
    const status = Number(payload.status_code || response.status);
    if (!response.ok || (status && status >= 400)) {
      if (payload.error_type === "INVALID_TOKEN" || payload.error_type === "SESSION_EXPIRED") signOut(false);
      throw new Error(typeof payload.message === "string" ? payload.message : "ParkSwap could not complete that action.");
    }
    return payload;
  }
  function setBusy(button, busy, label) {
    if (!button) return;
    button.disabled = busy;
    const span = button.querySelector("span");
    if (span) { if (!button.dataset.label) button.dataset.label = span.textContent; span.textContent = busy ? label : button.dataset.label; }
  }
  function message(el, text, success = false) { el.textContent = text || ""; el.classList.toggle("success", success); }
  function toast(text) { const el = $("toast"); el.textContent = text; el.classList.remove("hidden"); clearTimeout(toast.timer); toast.timer = setTimeout(() => el.classList.add("hidden"), 3600); }
  function saveSession(payload) {
    const user = payload?.data?.user_details || payload?.data?.user || payload?.user_details;
    if (!user?.auth_token) throw new Error("ParkSwap signed in but did not return a session. Please try again.");
    state.token = user.auth_token; state.user = user; state.vehicle = user.carinfo || null;
    localStorage.setItem("parkswap_token", state.token);
    localStorage.setItem("parkswap_user", JSON.stringify(user));
    if (state.vehicle) localStorage.setItem("parkswap_vehicle", JSON.stringify(state.vehicle));
  }
  function signOut(showToast = true) {
    state.token = ""; state.user = null; state.vehicle = null; state.mode = 0; state.spots = [];
    ["parkswap_token", "parkswap_user", "parkswap_vehicle", "parkswap_mode"].forEach((key) => localStorage.removeItem(key));
    clearInterval(state.refreshTimer); state.refreshTimer = null;
    mainView.classList.add("hidden"); authView.classList.remove("hidden");
    if (showToast) toast("Signed out safely.");
  }

  function randomNonce() {
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
  }
  function loadScript(src, id) {
    return new Promise((resolve, reject) => {
      const existing = document.getElementById(id);
      if (existing) { if (existing.dataset.ready === "true") resolve(); else existing.addEventListener("load", resolve, { once: true }); return; }
      const script = document.createElement("script");
      script.id = id; script.src = src; script.async = true; script.defer = true;
      script.addEventListener("load", () => { script.dataset.ready = "true"; resolve(); }, { once: true });
      script.addEventListener("error", () => reject(new Error("The identity provider could not load.")), { once: true });
      document.head.appendChild(script);
    });
  }
  async function finishSocialIdentity(provider, idToken, nonce) {
    if (state.socialBusy) return;
    state.socialBusy = true; message(authMessage, `Finishing ${provider === "google" ? "Google" : "Apple"} sign-in…`, true);
    try {
      const payload = await api("/v1/auth/social-identity", { method: "POST", data: {
        provider, id_token: idToken, nonce, device_token: `web-${deviceId()}`,
      }, auth: false });
      saveSession(payload);
      await enterApp();
      if (payload?.data?.is_new_user) openVehicleModal();
    } catch (error) { message(authMessage, error.message); }
    finally { state.socialBusy = false; }
  }
  async function initializeSocialIdentity() {
    try {
      const payload = await api("/v1/auth/social-config", { auth: false });
      state.socialConfig = payload?.data || {};
      if (state.socialConfig.google?.enabled && state.socialConfig.google.client_id) {
        await loadScript("https://accounts.google.com/gsi/client", "google-identity-services");
        state.googleNonce = randomNonce();
        window.google.accounts.id.initialize({
          client_id: state.socialConfig.google.client_id,
          nonce: state.googleNonce,
          cancel_on_tap_outside: true,
          callback: (response) => finishSocialIdentity("google", response.credential, state.googleNonce),
        });
        const slot = $("googleIdentityButton");
        slot.classList.remove("hidden"); $("googleRecoveryButton").classList.add("hidden");
        window.google.accounts.id.renderButton(slot, { type: "standard", theme: "filled_black", size: "large", shape: "rectangular", text: "continue_with", width: Math.min(440, Math.max(250, slot.clientWidth || 320)) });
      }
      if (state.socialConfig.apple?.enabled && state.socialConfig.apple.client_id) {
        await loadScript("https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js", "apple-signin-sdk");
        $("appleIdentityButton").dataset.socialReady = "true";
      }
    } catch {
      // Password recovery remains available when provider configuration is unavailable.
    }
  }

  document.querySelectorAll("[data-auth-tab]").forEach((button) => button.addEventListener("click", () => {
    document.querySelectorAll("[data-auth-tab]").forEach((item) => { item.classList.toggle("active", item === button); item.setAttribute("aria-selected", item === button ? "true" : "false"); });
    $("loginForm").classList.toggle("hidden", button.dataset.authTab !== "login");
    $("signupForm").classList.toggle("hidden", button.dataset.authTab !== "signup");
    message(authMessage, "");
  }));

  $("loginForm").addEventListener("submit", async (event) => {
    event.preventDefault(); const button = event.currentTarget.querySelector("button"); setBusy(button, true, "Signing in…"); message(authMessage, "");
    const data = Object.fromEntries(new FormData(event.currentTarget)); data.device_token = `web-${deviceId()}`;
    try { saveSession(await api("/v1/auth/login", { method: "POST", data, auth: false })); await enterApp(); }
    catch (error) { message(authMessage, error.message); }
    finally { setBusy(button, false); }
  });
  $("signupForm").addEventListener("submit", async (event) => {
    event.preventDefault(); const button = event.currentTarget.querySelector("button"); setBusy(button, true, "Creating account…"); message(authMessage, "");
    const data = Object.fromEntries(new FormData(event.currentTarget));
    if (data.password !== data.confirm_password) { message(authMessage, "Passwords do not match."); setBusy(button, false); return; }
    data.device_token = `web-${deviceId()}`;
    try { saveSession(await api("/v1/auth/signup", { method: "POST", data, auth: false })); await enterApp(); openVehicleModal(); }
    catch (error) { message(authMessage, error.message); }
    finally { setBusy(button, false); }
  });

  function restoreStandardAuth() {
    $("socialRecoveryForm").classList.add("hidden");
    $("socialAccess").classList.remove("hidden");
    const activeTab = document.querySelector("[data-auth-tab].active")?.dataset.authTab || "login";
    $("loginForm").classList.toggle("hidden", activeTab !== "login");
    $("signupForm").classList.toggle("hidden", activeTab !== "signup");
  }
  document.querySelectorAll("[data-social-recovery]").forEach((button) => button.addEventListener("click", () => {
    const provider = button.dataset.socialRecovery;
    if (provider === "Apple" && button.dataset.socialReady === "true") return;
    const existingEmail = $("loginForm").elements.email.value || $("signupForm").elements.email.value || "";
    $("loginForm").classList.add("hidden");
    $("signupForm").classList.add("hidden");
    $("socialAccess").classList.add("hidden");
    $("socialRecoveryForm").classList.remove("hidden");
    $("recoveryTitle").textContent = `${provider} account access`;
    $("recoveryProviderMark").textContent = provider === "Google" ? "G" : "●";
    $("recoveryProviderMark").className = `provider-mark ${provider === "Google" ? "google-mark" : "apple-provider-mark"}`;
    $("socialRecoveryEmail").value = existingEmail;
    $("socialRecoveryEmail").focus();
    message(authMessage, "We’ll email a temporary password for this existing ParkSwap account.", true);
  }));
  $("appleIdentityButton").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    if (button.dataset.socialReady !== "true" || state.socialBusy) return;
    const nonce = randomNonce();
    button.disabled = true; message(authMessage, "Opening Apple sign-in…", true);
    try {
      window.AppleID.auth.init({
        clientId: state.socialConfig.apple.client_id,
        scope: "name email",
        redirectURI: `${location.origin}/app/`,
        state: randomNonce(), nonce, usePopup: true,
      });
      const response = await window.AppleID.auth.signIn();
      await finishSocialIdentity("apple", response.authorization.id_token, nonce);
    } catch (error) {
      if (error?.error !== "popup_closed_by_user") message(authMessage, "Apple sign-in could not be completed. Please try again.");
    } finally { button.disabled = false; }
  });
  $("cancelSocialRecovery").addEventListener("click", () => { restoreStandardAuth(); message(authMessage, ""); });
  $("socialRecoveryForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = event.currentTarget.querySelector(".primary-button");
    const email = $("socialRecoveryEmail").value.trim();
    setBusy(button, true, "Sending secure access…"); message(authMessage, "");
    try {
      await api("/v1/auth/reset-password", { method: "PUT", data: { email }, auth: false });
      restoreStandardAuth();
      $("loginForm").elements.email.value = email;
      $("loginForm").elements.password.value = "";
      message(authMessage, "Check your inbox for your temporary ParkSwap password, then sign in above.", true);
    } catch (error) { message(authMessage, error.message); }
    finally { setBusy(button, false); }
  });

  initializeSocialIdentity();

  async function enterApp() {
    authView.classList.add("hidden"); mainView.classList.remove("hidden");
    $("profileName").textContent = state.user?.full_name || "ParkSwap Driver";
    $("profileEmail").textContent = state.user?.email || "";
    renderVehicle(); initializeMap(); locate(); renderMode();
    clearInterval(state.refreshTimer); state.refreshTimer = setInterval(() => { if (state.coords) loadSpots(false); }, 15000);
  }
  function initializeMap() {
    if (state.map || !window.L) return;
    state.map = L.map("map", { zoomControl: false, attributionControl: true }).setView([40.7128, -74.006], 13);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap" }).addTo(state.map);
  }
  function locate() {
    $("locationStatus").textContent = "Finding your location…";
    if (!navigator.geolocation) { $("locationStatus").textContent = "Location is unavailable"; return; }
    navigator.geolocation.getCurrentPosition((position) => {
      state.coords = { latitude: position.coords.latitude, longitude: position.coords.longitude, accuracy: position.coords.accuracy };
      $("locationStatus").textContent = position.coords.accuracy < 100 ? "Location ready" : "Approximate location";
      if (state.map) {
        state.map.setView([state.coords.latitude, state.coords.longitude], 15);
        if (state.userMarker) state.userMarker.remove();
        state.userMarker = L.marker([state.coords.latitude, state.coords.longitude], { icon: L.divIcon({ className: "user-pin", iconSize: [18, 18] }) }).addTo(state.map);
      }
      loadSpots();
    }, () => { $("locationStatus").textContent = "Allow location to use ParkSwap"; toast("ParkSwap needs your location to show nearby parking activity."); }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 15000 });
  }
  async function loadSpots(showErrors = true) {
    if (!state.coords || !state.token) return;
    try {
      const payload = await api(`/v1/parking/list?latitude=${encodeURIComponent(state.coords.latitude)}&longitude=${encodeURIComponent(state.coords.longitude)}`);
      const data = payload?.data || {}; const incoming = Array.isArray(data.parking_list) ? data.parking_list : [];
      const previousIds = new Set(state.spots.map(spotId)); state.spots = incoming.filter((item) => Number(item.type) === 2 || Number(item.parkingStatus) === 2);
      renderSpots();
      const fresh = state.spots.filter((item) => !previousIds.has(spotId(item)));
      if (fresh.length && previousIds.size) notifyNewSpot(fresh.length);
      if (data.swap) renderConnection(data.swap);
    } catch (error) { if (showErrors) toast(error.message); }
  }
  function spotId(item) { return String(item.parkingID || item.id || item.user_id || item.userID || `${item.latitude}-${item.longitude}`); }
  function field(item, ...keys) { for (const key of keys) if (item?.[key] != null && item[key] !== "") return item[key]; return ""; }
  function distanceMiles(a, b) {
    if (!state.coords || !a || !b) return null;
    const rad = Math.PI / 180, lat1 = state.coords.latitude * rad, lat2 = Number(a) * rad, dLat = (Number(a) - state.coords.latitude) * rad, dLon = (Number(b) - state.coords.longitude) * rad;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
    return 3958.8 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  }
  function renderSpots() {
    $("nearbyCount").textContent = `${state.spots.length} nearby`;
    state.spotMarkers.forEach((marker) => marker.remove()); state.spotMarkers = [];
    if (state.map && window.L) state.spots.forEach((item) => {
      const lat = Number(field(item, "latitude", "profile_latitude")), lon = Number(field(item, "longitude", "profile_longitude"));
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
      const marker = L.marker([lat, lon], { icon: L.divIcon({ className: "parking-pin", html: "<span>P</span>", iconSize: [36, 36], iconAnchor: [18, 36] }) }).addTo(state.map);
      marker.on("click", () => openSpot(item)); state.spotMarkers.push(marker);
    });
    const list = $("activityList");
    if (!state.spots.length) { list.innerHTML = '<div class="empty-state"><span>⌖</span><h3>No nearby activity yet</h3><p>Start looking and ParkSwap will refresh automatically.</p></div>'; return; }
    list.innerHTML = "";
    state.spots.forEach((item) => {
      const lat = field(item, "latitude", "profile_latitude"), lon = field(item, "longitude", "profile_longitude"), miles = distanceMiles(lat, lon);
      const button = document.createElement("button"); button.className = "activity-card";
      button.innerHTML = `<span class="activity-icon">P</span><span><strong>Driver leaving a spot</strong><small>${escapeHtml(field(item, "location", "address") || "Nearby parking activity")}</small></span><b>${miles == null ? "Live" : miles < .1 ? "Nearby" : `${miles.toFixed(1)} mi`}</b>`;
      button.addEventListener("click", () => openSpot(item)); list.appendChild(button);
    });
  }
  function escapeHtml(value) { const div = document.createElement("div"); div.textContent = String(value); return div.innerHTML; }
  function openSpot(item) {
    state.selectedSpot = item;
    const lat = field(item, "latitude", "profile_latitude"), lon = field(item, "longitude", "profile_longitude"), miles = distanceMiles(lat, lon);
    $("spotAddress").textContent = field(item, "location", "address") || "Nearby parking activity";
    $("spotDistance").textContent = miles == null ? "Nearby" : miles < .1 ? "Nearby" : `${miles.toFixed(1)} mi`;
    $("spotUpdated").textContent = "Live";
    $("directionsButton").href = `https://maps.apple.com/?daddr=${encodeURIComponent(lat)},${encodeURIComponent(lon)}&dirflg=d`;
    $("claimButton").disabled = state.mode !== 1;
    $("claimButton").querySelector("span").textContent = state.mode === 1 ? "I'm heading there" : "Start looking to claim";
    spotModal.classList.remove("hidden");
  }
  async function setMode(type) {
    if (!state.coords) { locate(); toast("ParkSwap needs your location first."); return; }
    const button = type === 1 ? $("lookButton") : $("leaveButton"); setBusy(button, true, type === 1 ? "Starting search…" : "Sharing spot…");
    try {
      await api("/v1/parking/request", { method: "POST", data: { location: "Current location", latitude: state.coords.latitude, longitude: state.coords.longitude, type } });
      state.mode = type; localStorage.setItem("parkswap_mode", String(type)); renderMode(); await loadSpots(false);
      toast(type === 1 ? "Looking for nearby parking activity." : "Your live departure was shared with nearby drivers.");
    } catch (error) {
      if (/car|vehicle/i.test(error.message)) openVehicleModal();
      toast(error.message);
    } finally { setBusy(button, false); }
  }
  async function stopMode() {
    if (!state.coords) return;
    try { await api("/v1/parking/request", { method: "POST", data: { location: "Current location", latitude: state.coords.latitude, longitude: state.coords.longitude, type: 0 } }); state.mode = 0; localStorage.removeItem("parkswap_mode"); renderMode(); toast("Parking activity stopped."); }
    catch (error) { toast(error.message); }
  }
  function renderMode() {
    const active = $("activeMode"), stop = $("stopButton");
    if (!state.mode) { active.classList.add("hidden"); stop.classList.add("hidden"); return; }
    active.classList.remove("hidden"); stop.classList.remove("hidden");
    active.textContent = state.mode === 1 ? "Looking is active. ParkSwap is refreshing nearby departures automatically." : "Your spot is live. Stay safely parked while another driver responds.";
  }
  async function claimSelected() {
    const item = state.selectedSpot; if (!item || state.mode !== 1 || !state.coords) return;
    const button = $("claimButton"); setBusy(button, true, "Claiming…");
    const leavingUserId = field(item, "user_id", "userID", "userId");
    try {
      const payload = await api("/v1/parking/swap-spot", { method: "POST", data: {
        leaving_user_id: leavingUserId,
        looking_location: "Current location", looking_latitude: state.coords.latitude, looking_longitude: state.coords.longitude,
        leaving_location: field(item, "location", "address") || "Shared spot",
        leaving_latitude: field(item, "latitude", "profile_latitude"), leaving_longitude: field(item, "longitude", "profile_longitude"),
      }});
      spotModal.classList.add("hidden"); renderConnection(payload?.data?.swap_details || {}); toast("You are connected. Open directions when it is safe.");
    } catch (error) { toast(error.message); }
    finally { setBusy(button, false); }
  }
  function renderConnection(swap) {
    if (!swap || !Object.keys(swap).length) return;
    const status = $("activeMode"); status.classList.remove("hidden"); status.textContent = "Handoff connected. ParkSwap will keep refreshing the spot status while you approach.";
  }

  function openVehicleModal() { message($("vehicleMessage"), ""); vehicleModal.classList.remove("hidden"); }
  function renderVehicle() {
    const vehicle = state.vehicle || state.user?.carinfo;
    $("vehicleSummary").textContent = vehicle ? [field(vehicle, "color"), field(vehicle, "make"), field(vehicle, "model"), field(vehicle, "plate_number")].filter(Boolean).join(" · ") : "Add your vehicle so another driver can recognize you during a handoff.";
  }
  $("vehicleForm").addEventListener("submit", async (event) => {
    event.preventDefault(); const button = event.currentTarget.querySelector("button"); setBusy(button, true, "Saving…"); message($("vehicleMessage"), "");
    const data = Object.fromEntries(new FormData(event.currentTarget));
    try {
      const payload = await api("/v1/auth/car-details", { method: "POST", data });
      state.vehicle = payload?.data?.user_details?.carinfo || data; localStorage.setItem("parkswap_vehicle", JSON.stringify(state.vehicle));
      try { await api("/v1/auth/complete-onboarding", { method: "PATCH" }); } catch {}
      renderVehicle(); message($("vehicleMessage"), "Vehicle saved.", true); setTimeout(() => vehicleModal.classList.add("hidden"), 500);
    } catch (error) { message($("vehicleMessage"), error.message); }
    finally { setBusy(button, false); }
  });

  async function enableNotifications() {
    if (!("Notification" in window)) { toast("Notifications are not supported by this browser."); return; }
    const result = await Notification.requestPermission(); toast(result === "granted" ? "Parking alerts are enabled while ParkSwap is open." : "Notifications were not enabled.");
  }
  function notifyNewSpot(count) {
    if (Notification.permission === "granted" && document.hidden) new Notification("ParkSwap", { body: `${count} new parking ${count === 1 ? "opportunity" : "opportunities"} nearby.`, icon: "icon-192.png" });
    $("alertBadge").textContent = String(count); $("alertBadge").classList.remove("hidden");
  }
  async function installApp() { if (state.installPrompt) { state.installPrompt.prompt(); await state.installPrompt.userChoice; state.installPrompt = null; $("installButton").classList.add("hidden"); } else { toast(/iphone|ipad|ipod/i.test(navigator.userAgent) ? "On iPhone, tap Share, then Add to Home Screen." : "Use your browser menu and choose Install ParkSwap."); } }
  window.addEventListener("beforeinstallprompt", (event) => { event.preventDefault(); state.installPrompt = event; $("installButton").classList.remove("hidden"); });

  $("lookButton").addEventListener("click", () => setMode(1)); $("leaveButton").addEventListener("click", () => setMode(2)); $("stopButton").addEventListener("click", stopMode);
  $("recenterButton").addEventListener("click", locate); $("claimButton").addEventListener("click", claimSelected); $("editVehicleButton").addEventListener("click", openVehicleModal);
  $("enableNotifications").addEventListener("click", enableNotifications); $("installButton").addEventListener("click", installApp); $("installFromProfile").addEventListener("click", installApp);
  $("signOutButton").addEventListener("click", () => signOut()); $("alertsButton").addEventListener("click", () => { $("alertBadge").classList.add("hidden"); showPanel("activityPanel"); });
  document.querySelectorAll("[data-close-modal]").forEach((el) => el.addEventListener("click", () => { vehicleModal.classList.add("hidden"); spotModal.classList.add("hidden"); }));
  document.querySelectorAll(".modal-close").forEach((el) => el.addEventListener("click", () => el.closest(".modal").classList.add("hidden")));
  document.querySelectorAll("[data-panel]").forEach((button) => button.addEventListener("click", () => showPanel(button.dataset.panel)));
  function showPanel(id) { document.querySelectorAll(".panel").forEach((panel) => panel.classList.toggle("active-panel", panel.id === id)); document.querySelectorAll("[data-panel]").forEach((button) => button.classList.toggle("active", button.dataset.panel === id)); if (id === "mapPanel" && state.map) setTimeout(() => state.map.invalidateSize(), 50); }

  if ("serviceWorker" in navigator) window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
  if (state.token && state.user) enterApp();
})();
