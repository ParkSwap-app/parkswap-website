(() => {
  // The product and its API share app.parkswap.com. Keeping these requests
  // same-origin prevents browsers from blocking identity and parking actions.
  const API = "/api";
  const state = {
    token: localStorage.getItem("parkswap_token") || "",
    user: safeParse(localStorage.getItem("parkswap_user")) || null,
    vehicle: safeParse(localStorage.getItem("parkswap_vehicle")) || null,
    accountRole: localStorage.getItem("parkswap_account_role") || "driver",
    coords: null,
    mode: Number(localStorage.getItem("parkswap_mode")) || 0,
    spots: [],
    activityZones: [],
    activeScheduled: safeParse(localStorage.getItem("parkswap_scheduled_departure")) || null,
    activeSpotter: safeParse(localStorage.getItem("parkswap_spotter_report")) || null,
    selectedSpot: null,
    map: null,
    mapStarting: false,
    mapFallbackActive: false,
    userMarker: null,
    spotMarkers: [],
    activityZoneLayers: [],
    installPrompt: null,
    refreshTimer: null,
    socialConfig: null,
    googleNonce: "",
    socialBusy: false,
    pendingAction: null,
    manualLocationMode: false,
    locationRequestId: 0,
    exploreCoords: null,
    exploreLabel: "",
    exploreMarker: null,
    destinationResults: [],
    destinationSearchTimer: null,
    destinationSearchController: null,
    destinationSearchSequence: 0,
    searchOnlyMode: false,
    scheduleTimer: null,
  };

  const $ = (id) => document.getElementById(id);
  const authView = $("authView");
  const mainView = $("mainView");
  const authMessage = $("authMessage");
  const vehicleModal = $("vehicleModal");
  const spotModal = $("spotModal");
  const scheduleModal = $("scheduleModal");
  const locationModal = $("locationModal");
  const spotterModal = $("spotterModal");

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
  async function api(path, { method = "GET", data = null, auth = true, extraHeaders = null } = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 9000);
    const options = { method, headers: { ...headers(auth), ...(extraHeaders || {}) }, cache: "no-store", signal: controller.signal };
    if (data) {
      const body = new FormData();
      Object.entries(data).forEach(([key, value]) => body.append(key, value == null ? "" : String(value)));
      options.body = body;
    }
    let response;
    try { response = await fetch(`${API}${path}`, options); }
    catch (error) {
      if (error?.name === "AbortError") throw new Error("ParkSwap's live service took too long to respond. Please try again.");
      throw new Error("ParkSwap could not reach the service. Check your connection and try again.");
    }
    let payload;
    try {
      const text = (await response.text()).replace(/^\uFEFF/, "").trim();
      payload = text ? JSON.parse(text) : {};
    } catch (error) {
      if (error?.name === "AbortError") throw new Error("ParkSwap's live service took too long to respond. Please try again.");
      throw new Error(response.ok
        ? "ParkSwap's live service returned an invalid response. Please try again."
        : "ParkSwap's live service is reconnecting. Please try again in a moment.");
    } finally { clearTimeout(timeout); }
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
    const span = button.querySelector("strong") || button.querySelector("span");
    if (span) { if (!button.dataset.label) button.dataset.label = span.textContent; span.textContent = busy ? label : button.dataset.label; }
  }
  function message(el, text, success = false) { el.textContent = text || ""; el.classList.toggle("success", success); }
  function toast(text) { const el = $("toast"); el.textContent = text; el.classList.remove("hidden"); clearTimeout(toast.timer); toast.timer = setTimeout(() => el.classList.add("hidden"), 3600); }
  function withDeadline(promise, milliseconds = 9000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("ParkSwap's live service took too long to respond. Please try again.")), milliseconds);
      promise.then((value) => { clearTimeout(timer); resolve(value); }, (error) => { clearTimeout(timer); reject(error); });
    });
  }
  function saveSession(payload) {
    const user = payload?.data?.user_details || payload?.data?.user || payload?.user_details;
    if (!user?.auth_token) throw new Error("ParkSwap signed in but did not return a session. Please try again.");
    state.token = user.auth_token; state.user = user; state.vehicle = user.carinfo || null;
    localStorage.setItem("parkswap_token", state.token);
    localStorage.setItem("parkswap_user", JSON.stringify(user));
    if (state.vehicle) localStorage.setItem("parkswap_vehicle", JSON.stringify(state.vehicle));
  }
  function setAccountRole(role) {
    state.accountRole = role === "spotter" ? "spotter" : "driver";
    localStorage.setItem("parkswap_account_role", state.accountRole);
    document.querySelectorAll('input[name="account_role"]').forEach((input) => {
      input.checked = input.value === state.accountRole;
    });
    $("accountRole").textContent = state.accountRole === "spotter" ? "Spotter" : "Driver";
    $("vehicleCard").classList.toggle("hidden", state.accountRole === "spotter");
    $("driverActions").classList.toggle("hidden", state.accountRole === "spotter");
    $("spotterActions").classList.toggle("hidden", state.accountRole !== "spotter");
  }
  function signOut(showToast = true) {
    state.token = ""; state.user = null; state.vehicle = null; state.mode = 0; state.spots = []; state.accountRole = "driver";
    ["parkswap_token", "parkswap_user", "parkswap_vehicle", "parkswap_mode", "parkswap_account_role", "parkswap_scheduled_departure", "parkswap_spotter_report"].forEach((key) => localStorage.removeItem(key));
    setAccountRole("driver");
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
    if (!idToken) {
      message(authMessage, `${provider === "google" ? "Google" : "Apple"} did not return a sign-in credential. Please try again or use secure email access below.`);
      return;
    }
    state.socialBusy = true; message(authMessage, `Finishing ${provider === "google" ? "Google" : "Apple"} sign-in…`, true);
    try {
      const payload = await api("/v1/auth/social-identity", { method: "POST", data: {
        provider, id_token: idToken, nonce, device_token: `web-${deviceId()}`,
      }, auth: false });
      saveSession(payload);
      if (payload?.data?.is_new_user) {
        const selectedRole = document.querySelector('input[name="account_role"]:checked')?.value || "driver";
        setAccountRole(selectedRole);
      }
      await enterApp();
      if (payload?.data?.is_new_user && state.accountRole === "driver") openVehicleModal();
      if (payload?.data?.is_new_user && state.accountRole === "spotter") toast("Spotter profile ready. No vehicle required.");
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
          ux_mode: "popup",
          context: "signin",
          itp_support: true,
          use_fedcm_for_button: true,
          state_cookie_domain: "parkswap.com",
          cancel_on_tap_outside: true,
          callback: (response) => finishSocialIdentity("google", response?.credential, state.googleNonce),
        });
        const slot = $("googleIdentityButton");
        slot.classList.remove("hidden"); $("googleRecoveryButton").classList.add("hidden");
        await new Promise((resolve) => requestAnimationFrame(resolve));
        let googleButtonWidth = 0;
        const renderGoogleButton = () => {
          const width = Math.max(200, Math.min(400, Math.floor(slot.getBoundingClientRect().width || 320)));
          if (Math.abs(width - googleButtonWidth) < 3 && slot.querySelector("iframe")) return;
          googleButtonWidth = width;
          slot.replaceChildren();
          window.google.accounts.id.renderButton(slot, {
            type: "standard",
            theme: "outline",
            size: "large",
            shape: "rectangular",
            text: "continue_with",
            logo_alignment: "left",
            width,
            click_listener: () => message(authMessage, "Opening secure Google sign-in…", true),
          });
        };
        renderGoogleButton();
        if (window.ResizeObserver) new ResizeObserver(() => {
          clearTimeout(renderGoogleButton.timer);
          renderGoogleButton.timer = setTimeout(renderGoogleButton, 120);
        }).observe(slot);
      }
      if (state.socialConfig.apple?.enabled && state.socialConfig.apple.client_id) {
        await loadScript("https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js", "apple-signin-sdk");
        $("appleIdentityButton").dataset.socialReady = "true";
      }
    } catch {
      $("googleIdentityButton").classList.add("hidden");
      $("googleRecoveryButton").classList.remove("hidden");
      message(authMessage, "Google sign-in could not load. Use secure email access below to keep the same ParkSwap account.");
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
    try {
      setAccountRole(data.account_role);
      saveSession(await api("/v1/auth/signup", { method: "POST", data, auth: false }));
      await enterApp();
      if (state.accountRole === "driver") openVehicleModal();
      else toast("Spotter profile ready. No vehicle required.");
    }
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
    setAccountRole(state.accountRole);
    $("profileName").textContent = state.user?.full_name || (state.accountRole === "spotter" ? "ParkSwap Spotter" : "ParkSwap Driver");
    $("profileEmail").textContent = state.user?.email || "";
    renderVehicle(); initializeMap(); renderMode();
    restoreNetworkState();
    scheduleLocalReminder();
    refreshMapSize();
    setTimeout(refreshMapSize, 250);
    setTimeout(refreshMapSize, 900);
    locate();
    clearInterval(state.refreshTimer); state.refreshTimer = setInterval(() => { if (state.coords || state.exploreCoords) loadSpots(false); }, 15000);
  }
  async function restoreNetworkState() {
    try {
      const payload = await api("/v1/parking-network/scheduled-departures/active");
      const active = payload?.data?.scheduled_departure;
      if (active?.id) {
        state.activeScheduled = active;
        localStorage.setItem("parkswap_scheduled_departure", JSON.stringify(active));
        renderMode();
      }
    } catch {
      // Existing clients and disabled rollouts continue to use the local reminder.
    }
    if (state.accountRole === "spotter") {
      try {
        const payload = await api("/v1/parking-network/spotter-reports/active");
        const active = payload?.data?.spotter_report;
        if (active?.id) {
          state.activeSpotter = active;
          localStorage.setItem("parkswap_spotter_report", JSON.stringify(active));
        }
      } catch {}
    }
  }
  function refreshMapSize() {
    if (!state.map) return;
    state.map.invalidateSize({ pan: false, animate: false });
  }
  async function initializeMap() {
    if (state.map || state.mapStarting) return;
    state.mapStarting = true;
    if (!window.L) {
      $("locationStatus").textContent = "Starting the parking map…";
      try { await loadScript("vendor/leaflet/leaflet.js?v=1.9.4-runtime", "leaflet-runtime"); } catch {}
    }
    if (!window.L) {
      state.mapStarting = false;
      $("locationStatus").textContent = "Map could not start — reload ParkSwap";
      return;
    }
    await new Promise((resolve) => requestAnimationFrame(resolve));
    state.map = L.map("map", { zoomControl: false, attributionControl: true }).setView([40.7128, -74.006], 13);
    state.mapStarting = false;
    let primaryTileLoads = 0;
    let fallbackTileLoads = 0;
    const fallbackTiles = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      crossOrigin: true,
      attribution: "© OpenStreetMap contributors",
    });
    const primaryTiles = L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
      maxZoom: 20,
      subdomains: "abcd",
      crossOrigin: true,
      attribution: "© OpenStreetMap © CARTO",
    });
    const activateFallback = () => {
      if (!state.map || state.mapFallbackActive) return;
      state.mapFallbackActive = true;
      document.querySelector(".map-wrap")?.classList.add("map-fallback-active");
      if (state.map.hasLayer(primaryTiles)) primaryTiles.remove();
      if (!state.map.hasLayer(fallbackTiles)) fallbackTiles.addTo(state.map);
    };
    const tileWatchdog = setTimeout(() => { if (primaryTileLoads === 0) activateFallback(); }, 2400);
    primaryTiles.on("tileload", () => { primaryTileLoads += 1; clearTimeout(tileWatchdog); });
    primaryTiles.on("tileerror", activateFallback);
    fallbackTiles.on("tileload", () => {
      fallbackTileLoads += 1;
      if (fallbackTileLoads === 1 && !state.coords && !state.exploreCoords) $("locationStatus").textContent = "Map ready — search or enable location";
    });
    fallbackTiles.on("tileerror", () => {
      if (fallbackTileLoads === 0) $("locationStatus").textContent = "Map is reconnecting — search still works";
    });
    primaryTiles.addTo(state.map);
    state.map.whenReady(refreshMapSize);
    state.map.on("click", (event) => {
      if (!state.manualLocationMode) return;
      applyCoordinates(event.latlng.lat, event.latlng.lng, null, true);
    });
    if (window.ResizeObserver) new ResizeObserver(refreshMapSize).observe($("map"));
  }
  function openLocationModal(text = "") {
    locationModal.classList.remove("hidden");
    $("locationMessage").textContent = text;
  }
  function runPendingAction() {
    const action = state.pendingAction;
    state.pendingAction = null;
    if (action === "look") setMode(1);
    else if (action === "leave") setMode(2);
    else if (action === "schedule") openScheduleModal();
    else if (action === "spotter") reportSpotterOpportunity();
  }
  function applyCoordinates(latitude, longitude, accuracy, manual = false) {
    state.coords = { latitude: Number(latitude), longitude: Number(longitude), accuracy: accuracy == null ? "" : Number(accuracy), manual };
    state.exploreCoords = null;
    state.exploreLabel = "";
    state.searchOnlyMode = false;
    if (state.exploreMarker) { state.exploreMarker.remove(); state.exploreMarker = null; }
    state.manualLocationMode = false;
    $("map").closest(".map-wrap").classList.remove("manual-location");
    locationModal.classList.add("hidden");
    $("locationStatus").textContent = manual ? "Location selected on map" : (Number(accuracy) < 100 ? "Location ready" : "Approximate location");
    if (state.map) state.map.setView([state.coords.latitude, state.coords.longitude], 15);
    renderUserMarker();
    loadSpots(false);
    if (manual) toast("Location selected. Continue with your parking action.");
    if (state.pendingAction) setTimeout(runPendingAction, 150);
  }
  function locationErrorMessage(error) {
    if (error?.code === 1) return "Location access is blocked. Choose a point on the map, or enable Location in your browser settings and try again.";
    if (error?.code === 2) return "Your current location is unavailable. Choose a point on the map to continue.";
    return "Location is taking too long. Choose a point on the map to continue now.";
  }
  function locate({ userInitiated = false } = {}) {
    const requestId = ++state.locationRequestId;
    const button = $("retryLocationButton");
    $("locationStatus").textContent = "Finding your location…";
    if (userInitiated) {
      openLocationModal("Your browser may show a location permission request.");
      setBusy(button, true, "Requesting access…");
    }
    if (!navigator.geolocation) {
      $("locationStatus").textContent = "Choose your location on the map";
      openLocationModal("Precise location is not available in this browser. Choose a point on the map to continue.");
      setBusy(button, false);
      return;
    }
    let settled = false;
    const finishWithError = (error) => {
      if (settled || requestId !== state.locationRequestId) return;
      settled = true;
      $("locationStatus").textContent = "Search an address or enable location";
      $("nearbyCount").textContent = "Search an area";
      if (userInitiated || state.pendingAction) openLocationModal(locationErrorMessage(error));
      setBusy(button, false);
    };
    const timeout = setTimeout(() => finishWithError({ code: 3 }), 8000);
    navigator.geolocation.getCurrentPosition((position) => {
      if (settled || requestId !== state.locationRequestId) return;
      settled = true; clearTimeout(timeout); setBusy(button, false);
      applyCoordinates(position.coords.latitude, position.coords.longitude, position.coords.accuracy);
    }, (error) => { clearTimeout(timeout); finishWithError(error); }, { enableHighAccuracy: true, timeout: 7000, maximumAge: 30000 });
  }
  async function loadSpots(showErrors = true) {
    if ((!state.coords && !state.exploreCoords) || !state.token) return;
    $("nearbyCount").textContent = "Refreshing activity…";
    try {
      const mapCoords = state.exploreCoords || state.coords;
      const latitude = encodeURIComponent(mapCoords.latitude), longitude = encodeURIComponent(mapCoords.longitude);
      const [legacyResult, scheduledResult, spotterResult, zonesResult] = await Promise.allSettled([
        withDeadline(api(`/v1/parking/list?latitude=${latitude}&longitude=${longitude}`)),
        withDeadline(api(`/v1/parking-network/scheduled-departures/nearby?latitude=${latitude}&longitude=${longitude}`)),
        withDeadline(api(`/v1/parking-network/spotter-reports/nearby?latitude=${latitude}&longitude=${longitude}`)),
        withDeadline(api(`/v1/parking/activity-zones?latitude=${latitude}&longitude=${longitude}`)),
      ]);
      const payload = legacyResult.status === "fulfilled" ? legacyResult.value : {};
      const data = payload?.data || {};
      const incoming = Array.isArray(data.parking_list) ? data.parking_list : [];
      const scheduledData = scheduledResult.status === "fulfilled" ? scheduledResult.value?.data : {};
      const scheduled = Array.isArray(scheduledData?.scheduled_departures)
        ? scheduledData.scheduled_departures.map((item) => ({ ...item, opportunity_type: "scheduled" })) : [];
      const spotterData = spotterResult.status === "fulfilled" ? spotterResult.value?.data : {};
      const spotter = Array.isArray(spotterData?.spotter_reports)
        ? spotterData.spotter_reports.map((item) => ({ ...item, opportunity_type: "spotter" })) : [];
      const zonesData = zonesResult.status === "fulfilled" ? zonesResult.value?.data : {};
      state.activityZones = Array.isArray(zonesData?.activity_zones) ? zonesData.activity_zones : [];
      const previousIds = new Set(state.spots.map(spotId));
      state.spots = [...incoming, ...scheduled, ...spotter].filter((item) => {
        const lat = Number(field(item, "latitude", "profile_latitude"));
        const lon = Number(field(item, "longitude", "profile_longitude"));
        return Number.isFinite(lat) && Number.isFinite(lon);
      });
      renderSpots();
      const fresh = state.spots.filter((item) => !previousIds.has(spotId(item)));
      if (fresh.length && previousIds.size) notifyNewSpot(fresh.length);
      if (data.swap) renderConnection(data.swap);
      const allUnavailable = [legacyResult, scheduledResult, spotterResult, zonesResult].every((result) => result.status === "rejected");
      if (allUnavailable && showErrors) toast("Live parking is reconnecting. You can still explore the map and try again.");
    } catch (error) {
      state.spots = [];
      state.activityZones = [];
      renderSpots();
      if (showErrors) toast(error.message || "Live parking is reconnecting. Please try again.");
    }
  }
  function closeDestinationResults() {
    state.destinationResults = [];
    const results = $("destinationResults");
    results.replaceChildren();
    results.classList.add("hidden");
    $("destinationInput").setAttribute("aria-expanded", "false");
  }
  function applyDestination(match) {
    const latitude = Number(match?.lat), longitude = Number(match?.lon);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
    state.exploreCoords = { latitude, longitude };
    state.exploreLabel = String(match?.display_name || "Selected destination").split(",").slice(0, 4).join(",");
    state.map?.setView([latitude, longitude], 15);
    if (state.exploreMarker) state.exploreMarker.remove();
    if (state.map && window.L) {
      state.exploreMarker = L.marker([latitude, longitude], {
        icon: L.divIcon({ className: "destination-pin", html: "<span>⌖</span>", iconSize: [32, 32], iconAnchor: [16, 16] }),
      }).addTo(state.map).bindPopup(`<strong>Parking search area</strong><br>${escapeHtml(state.exploreLabel)}`).openPopup();
    }
    $("destinationInput").value = state.exploreLabel;
    $("destinationInput").setAttribute("aria-activedescendant", "");
    $("locationStatus").textContent = `Exploring ${state.exploreLabel}`;
    closeDestinationResults();
    loadSpots().then(() => toast("Showing live opportunities and community activity near this address."));
  }
  function destinationCopy(match) {
    const address = match?.address || {};
    const parts = String(match?.display_name || "U.S. destination").split(",").map((part) => part.trim()).filter(Boolean);
    const street = [address.house_number, address.road || address.pedestrian || address.footway].filter(Boolean).join(" ");
    const name = String(match?.name || "").trim();
    const primary = name || street || parts[0] || "Matching destination";
    const locality = address.city || address.town || address.village || address.hamlet || address.borough || address.suburb || address.county;
    const region = [address.state, address.postcode].filter(Boolean).join(" ");
    const secondaryParts = [];
    if (street && street.toLowerCase() !== primary.toLowerCase()) secondaryParts.push(street);
    if (locality && !primary.toLowerCase().includes(String(locality).toLowerCase())) secondaryParts.push(locality);
    if (region) secondaryParts.push(region);
    const secondary = secondaryParts.join(" · ") || parts.slice(1, 4).join(", ") || "United States";
    return { primary, secondary };
  }
  function renderDestinationResults(matches) {
    const results = $("destinationResults");
    results.replaceChildren();
    state.destinationResults = matches;
    const header = document.createElement("div");
    header.className = "destination-results-header";
    header.setAttribute("role", "presentation");
    header.innerHTML = `<span><strong>Select an address</strong><small>Tap a result to view nearby parking</small></span><b>${matches.length} ${matches.length === 1 ? "match" : "matches"}</b>`;
    results.appendChild(header);
    matches.forEach((match, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "destination-result";
      button.id = `destination-result-${index}`;
      button.setAttribute("role", "option");
      const copy = destinationCopy(match);
      button.innerHTML = `<span aria-hidden="true">⌖</span><span class="destination-result-copy"><strong>${escapeHtml(copy.primary)}</strong><small>${escapeHtml(copy.secondary)}</small></span><b>Select</b>`;
      button.setAttribute("aria-label", `Choose ${String(match.display_name || `result ${index + 1}`)}`);
      button.addEventListener("click", () => applyDestination(match));
      results.appendChild(button);
    });
    results.classList.toggle("hidden", !matches.length);
    $("destinationInput").setAttribute("aria-expanded", matches.length ? "true" : "false");
  }
  async function exploreDestination(query, { autoApplySingle = false, quiet = false } = {}) {
    const value = String(query || "").trim();
    if (value.length < 3) {
      closeDestinationResults();
      if (!quiet) toast("Enter a neighborhood, address, or destination.");
      return;
    }
    const searchSequence = ++state.destinationSearchSequence;
    state.destinationSearchController?.abort();
    state.destinationSearchController = new AbortController();
    const button = $("destinationButton");
    if (!quiet) setBusy(button, true, "…");
    try {
      const search = encodeURIComponent(value);
      const response = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&countrycodes=us&addressdetails=1&limit=5&q=${search}`, {
        headers: { Accept: "application/json" },
        signal: state.destinationSearchController.signal,
      });
      if (!response.ok) throw new Error("Destination search is temporarily unavailable.");
      const results = await response.json();
      if (searchSequence !== state.destinationSearchSequence || $("destinationInput").value.trim() !== value) return;
      const matches = Array.isArray(results)
        ? results.filter((match) => Number.isFinite(Number(match?.lat)) && Number.isFinite(Number(match?.lon))).slice(0, 5)
        : [];
      if (!matches.length) {
        closeDestinationResults();
        if (!quiet) throw new Error("We could not find that U.S. address or destination. Add a street, city, state, or ZIP code and try again.");
        return;
      }
      renderDestinationResults(matches);
      $("locationStatus").textContent = matches.length === 1 ? "Choose the matching address" : `Choose from ${matches.length} matching places`;
      if (autoApplySingle && matches.length === 1) applyDestination(matches[0]);
    } catch (error) {
      if (error?.name !== "AbortError" && !quiet) toast(error.message || "Destination search is temporarily unavailable.");
    }
    finally { if (!quiet) setBusy(button, false); }
  }
  function spotId(item) { return String(item.parkingID || item.id || item.user_id || item.userID || `${item.latitude}-${item.longitude}`); }
  function field(item, ...keys) { for (const key of keys) if (item?.[key] != null && item[key] !== "") return item[key]; return ""; }
  function distanceMiles(a, b) {
    const origin = state.exploreCoords || state.coords;
    if (!origin || !a || !b) return null;
    const rad = Math.PI / 180, lat1 = origin.latitude * rad, lat2 = Number(a) * rad, dLat = (Number(a) - origin.latitude) * rad, dLon = (Number(b) - origin.longitude) * rad;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
    return 3958.8 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  }
  function renderSpots() {
    const liveLabel = state.spots.length === 1 ? "1 spot available now" : `${state.spots.length} spots available now`;
    const zoneLabel = state.activityZones.length === 1 ? "1 activity hot zone" : `${state.activityZones.length} activity hot zones`;
    $("nearbyCount").textContent = state.spots.length && state.activityZones.length
      ? `${liveLabel} · ${zoneLabel}`
      : state.spots.length ? liveLabel
      : state.activityZones.length ? zoneLabel : "No spots reported yet";
    state.spotMarkers.forEach((marker) => marker.remove()); state.spotMarkers = [];
    state.activityZoneLayers.forEach((layer) => layer.remove()); state.activityZoneLayers = [];
    if (state.map && window.L) state.activityZones.forEach((zone) => {
      const latitude = Number(zone.latitude), longitude = Number(zone.longitude);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
      const intensity = Math.max(1, Math.min(3, Number(zone.intensity) || 1));
      const radius = Math.max(800, Math.min(6500, Number(zone.radius_m) || (360 + (intensity * 190))));
      const circle = L.circle([latitude, longitude], {
        radius,
        className: `community-zone community-zone-${intensity}`,
        color: "#ff3b30",
        weight: 2,
        opacity: .72,
        fillColor: "#ff453a",
        fillOpacity: .1 + (intensity * .045),
        interactive: true,
      }).addTo(state.map);
      const memberRange = escapeHtml(zone.member_range || "Active ParkSwap community");
      const popup = `<div class="zone-popup"><strong>Parking activity hot zone</strong><span>${memberRange}</span><small>Approximate community density from anonymized ParkSwap activity. Individual people and exact locations are never shown.</small></div>`;
      circle.bindPopup(popup);
      const label = L.marker([latitude, longitude], {
        interactive: true,
        icon: L.divIcon({
          className: "hot-zone-marker",
          html: `<span class="hot-zone-badge"><strong>HOT ZONE</strong><small>${memberRange}</small></span>`,
          iconSize: [1, 1],
          iconAnchor: [0, 0],
        }),
      }).addTo(state.map).bindPopup(popup);
      state.activityZoneLayers.push(circle, label);
    });
    if (state.map && window.L) state.spots.forEach((item) => {
      const lat = Number(field(item, "latitude", "profile_latitude")), lon = Number(field(item, "longitude", "profile_longitude"));
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
      const scheduled = item.opportunity_type === "scheduled" || item.status === "pending" || item.status === "delayed";
      const spotter = item.opportunity_type === "spotter";
      const marker = L.marker([lat, lon], { icon: L.divIcon({ className: `parking-pin${scheduled || spotter ? " scheduled-pin" : ""}`, html: `<span>${scheduled ? "◷" : spotter ? "S" : "P"}</span>`, iconSize: [36, 36], iconAnchor: [18, 36] }) }).addTo(state.map);
      marker.on("click", () => openSpot(item)); state.spotMarkers.push(marker);
    });
    const list = $("activityList");
    if (!state.spots.length && !state.activityZones.length) { list.innerHTML = '<div class="empty-state"><span>⌖</span><h3>No nearby activity yet</h3><p>Start looking and ParkSwap will refresh automatically.</p></div>'; return; }
    list.innerHTML = "";
    state.activityZones.slice(0, 5).forEach((zone) => {
      const latitude = Number(zone.latitude), longitude = Number(zone.longitude);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
      const button = document.createElement("button");
      button.className = "activity-card hot-zone-card";
      button.innerHTML = `<span class="activity-icon">●</span><span><strong>Parking activity hot zone</strong><small>${escapeHtml(zone.member_range || "Active ParkSwap community")} · approximate, anonymous area</small></span><b>View</b>`;
      button.addEventListener("click", () => state.map?.setView([latitude, longitude], Math.max(13, state.map.getZoom())));
      list.appendChild(button);
    });
    state.spots.forEach((item) => {
      const lat = field(item, "latitude", "profile_latitude"), lon = field(item, "longitude", "profile_longitude"), miles = distanceMiles(lat, lon);
      const button = document.createElement("button"); button.className = "activity-card";
      const scheduled = item.opportunity_type === "scheduled" || item.status === "pending" || item.status === "delayed";
      const spotter = item.opportunity_type === "spotter";
      button.innerHTML = `<span class="activity-icon">${scheduled ? "◷" : spotter ? "S" : "P"}</span><span><strong>${scheduled ? "Leaving soon — not confirmed" : spotter ? "Unverified — reported by Spotter" : "Driver leaving a spot"}</strong><small>${escapeHtml(field(item, "location", "address") || "Nearby parking activity")}</small></span><b>${miles == null ? (scheduled ? "Soon" : "Live") : miles < .1 ? "Nearby" : `${miles.toFixed(1)} mi`}</b>`;
      button.addEventListener("click", () => openSpot(item)); list.appendChild(button);
    });
  }
  function escapeHtml(value) { const div = document.createElement("div"); div.textContent = String(value); return div.innerHTML; }
  function openSpot(item) {
    state.selectedSpot = item;
    const lat = field(item, "latitude", "profile_latitude"), lon = field(item, "longitude", "profile_longitude"), miles = distanceMiles(lat, lon);
    $("spotAddress").textContent = field(item, "location", "address") || "Nearby parking activity";
    $("spotDistance").textContent = miles == null ? "Nearby" : miles < .1 ? "Nearby" : `${miles.toFixed(1)} mi`;
    const scheduled = item.opportunity_type === "scheduled" || item.status === "pending" || item.status === "delayed";
    const spotter = item.opportunity_type === "spotter";
    $("spotTitle").textContent = scheduled ? "Driver leaving soon" : spotter ? "Unverified spotter report" : "Driver leaving nearby";
    $("spotUpdated").textContent = scheduled ? "Not confirmed" : spotter ? "Unverified" : "Live";
    $("directionsButton").href = `https://maps.apple.com/?daddr=${encodeURIComponent(lat)},${encodeURIComponent(lon)}&dirflg=d`;
    $("claimButton").disabled = state.mode !== 1 || scheduled;
    $("claimButton").querySelector("span").textContent = scheduled ? "Waiting for confirmation" : state.mode === 1 ? "I'm heading there" : "Start looking to claim";
    spotModal.classList.remove("hidden");
  }
  async function setMode(type) {
    const actionCoords = type === 1 ? (state.exploreCoords || state.coords) : state.coords;
    if (!actionCoords) { state.pendingAction = type === 1 ? "look" : "leave"; openLocationModal(type === 1 ? "Allow location, choose a point on the map, or search any U.S. address above." : "Your current location is required to share a parking departure."); return; }
    const button = type === 1 ? $("lookButton") : $("leaveButton"); setBusy(button, true, type === 1 ? "Starting search…" : "Sharing spot…");
    try {
      if (type === 1 && state.exploreCoords) {
        state.mode = 1;
        state.searchOnlyMode = true;
        localStorage.setItem("parkswap_mode", "1");
        renderMode();
        await loadSpots(false);
        toast(`Watching parking activity near ${state.exploreLabel || "this destination"}.`);
        return;
      }
      if (type === 2 && state.activeScheduled?.id && !state.activeScheduled.local_reminder) {
        await api(`/v1/parking-network/scheduled-departures/${encodeURIComponent(state.activeScheduled.id)}/confirm`, { method: "POST" });
        state.activeScheduled = null; localStorage.removeItem("parkswap_scheduled_departure");
      } else {
        await api("/v1/parking/request", { method: "POST", data: { location: "Current location", latitude: state.coords.latitude, longitude: state.coords.longitude, type } });
      }
      state.searchOnlyMode = false;
      state.mode = type; localStorage.setItem("parkswap_mode", String(type)); renderMode(); await loadSpots(false);
      toast(type === 1 ? "Looking for nearby parking activity." : "Your live departure was shared with nearby drivers.");
    } catch (error) {
      if (/car|vehicle/i.test(error.message)) openVehicleModal();
      toast(error.message);
    } finally { setBusy(button, false); }
  }
  function openScheduleModal() {
    if (!state.coords) { state.pendingAction = "schedule"; openLocationModal(); return; }
    message($("scheduleMessage"), "");
    scheduleModal.classList.remove("hidden");
  }
  $("scheduleForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!state.coords && state.mode === 1) {
      state.mode = 0; localStorage.removeItem("parkswap_mode"); renderMode(); toast("Parking watch stopped."); return;
    }
    if (!state.coords) return;
    const button = event.currentTarget.querySelector("button[type=submit]");
    const minutes = Number(new FormData(event.currentTarget).get("minutes"));
    const scheduledTime = new Date(Date.now() + minutes * 60000).toISOString();
    setBusy(button, true, "Scheduling…"); message($("scheduleMessage"), "");
    try {
      const payload = await api("/v1/parking-network/scheduled-departures", { method: "POST", data: {
        latitude: state.coords.latitude,
        longitude: state.coords.longitude,
        location_accuracy: state.coords.accuracy || "",
        scheduled_time: scheduledTime,
        idempotency_key: `scheduled-${deviceId()}-${Date.now()}`,
      }});
      state.activeScheduled = payload?.data?.scheduled_departure || null;
      if (state.activeScheduled) localStorage.setItem("parkswap_scheduled_departure", JSON.stringify(state.activeScheduled));
      scheduleModal.classList.add("hidden");
      renderMode();
      toast(`Departure scheduled for about ${minutes} minutes from now.`);
      await loadSpots(false);
    } catch (error) {
      state.activeScheduled = { scheduled_time: scheduledTime, status: "pending", local_reminder: true };
      localStorage.setItem("parkswap_scheduled_departure", JSON.stringify(state.activeScheduled));
      scheduleModal.classList.add("hidden");
      scheduleLocalReminder(); renderMode();
      toast(`Reminder set for about ${minutes} minutes from now. Confirm with Leave Spot Now when ready.`);
    }
    finally { setBusy(button, false); }
  });
  async function stopMode() {
    if (state.searchOnlyMode) {
      state.mode = 0; state.searchOnlyMode = false; localStorage.removeItem("parkswap_mode"); renderMode(); toast("Parking watch stopped."); return;
    }
    if (!state.mode && state.activeScheduled?.id && !state.activeScheduled.local_reminder) {
      try {
        await api(`/v1/parking-network/scheduled-departures/${encodeURIComponent(state.activeScheduled.id)}/cancel`, { method: "POST" });
        state.activeScheduled = null; localStorage.removeItem("parkswap_scheduled_departure"); renderMode(); toast("Leaving Soon cancelled.");
      } catch (error) { toast(error.message); }
      return;
    }
    if (!state.mode && state.activeScheduled?.local_reminder) {
      state.activeScheduled = null; localStorage.removeItem("parkswap_scheduled_departure"); clearTimeout(state.scheduleTimer); renderMode(); toast("Leaving Soon reminder cancelled."); return;
    }
    if (!state.coords) return;
    try { await api("/v1/parking/request", { method: "POST", data: { location: "Current location", latitude: state.coords.latitude, longitude: state.coords.longitude, type: 0 } }); state.mode = 0; localStorage.removeItem("parkswap_mode"); renderMode(); toast("Parking activity stopped."); }
    catch (error) { toast(error.message); }
  }
  function renderMode() {
    const active = $("activeMode"), stop = $("stopButton");
    renderUserMarker();
    if (!state.mode && state.activeScheduled?.local_reminder) {
      const due = new Date(state.activeScheduled.scheduled_time).getTime() <= Date.now();
      active.classList.remove("hidden"); stop.classList.remove("hidden");
      active.textContent = due ? "Your Leaving Soon reminder is due. Tap Leave Spot Now when you are ready to share the spot." : `Leaving Soon reminder set for ${new Date(state.activeScheduled.scheduled_time).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.`;
      return;
    }
    if (!state.mode) { active.classList.add("hidden"); stop.classList.add("hidden"); return; }
    active.classList.remove("hidden"); stop.classList.remove("hidden");
    active.textContent = state.mode === 1
      ? (state.exploreCoords ? `Watching parking near ${state.exploreLabel || "your destination"}. ParkSwap refreshes automatically.` : "Looking is active. ParkSwap is refreshing nearby departures automatically.")
      : "Your spot is live. Stay safely parked while another driver responds.";
  }
  function userMarkerClass() {
    if (state.mode === 1) return "user-pin looking-pin";
    if (state.mode === 2) return "user-pin leaving-pin";
    if (state.activeScheduled) return "user-pin scheduled-user-pin";
    return "user-pin";
  }
  function renderUserMarker() {
    if (!state.coords || !state.map || !window.L) return;
    if (state.userMarker) state.userMarker.remove();
    state.userMarker = L.marker([state.coords.latitude, state.coords.longitude], {
      icon: L.divIcon({ className: userMarkerClass(), iconSize: [20, 20] }),
    }).addTo(state.map);
    if (state.mode === 1) $("locationStatus").textContent = "Looking for parking";
    else if (state.mode === 2) $("locationStatus").textContent = "Your departure is live";
    else if (state.activeScheduled) $("locationStatus").textContent = "Leaving Soon reminder set";
  }
  function scheduleLocalReminder() {
    clearTimeout(state.scheduleTimer);
    if (!state.activeScheduled?.local_reminder) return;
    const delay = Math.max(0, new Date(state.activeScheduled.scheduled_time).getTime() - Date.now());
    state.scheduleTimer = setTimeout(() => {
      renderMode();
      toast("Are you leaving now? Tap Leave Spot Now to publish your spot.");
      if (Notification.permission === "granted") new Notification("Are you leaving now?", { body: "Open ParkSwap and confirm with Leave Spot Now.", icon: "icon-192.png" });
    }, Math.min(delay, 2147483647));
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
    $("vehicleCard").classList.toggle("hidden", state.accountRole === "spotter");
    if (state.accountRole === "spotter") return;
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
  function reportSpotterOpportunity() {
    if (!state.coords) { state.pendingAction = "spotter"; openLocationModal(); return; }
    spotterModal.classList.remove("hidden");
  }
  async function confirmSpotterOpportunity() {
    const button = $("confirmSpotterButton"); setBusy(button, true, "Reporting…");
    try {
      const payload = await api("/v1/parking-network/spotter-reports", { method: "POST", data: {
        latitude: state.coords.latitude,
        longitude: state.coords.longitude,
        location_accuracy: state.coords.accuracy || "",
        legal_public_space_confirmed: 1,
        idempotency_key: `spotter-${deviceId()}-${Date.now()}`,
      }});
      state.activeSpotter = payload?.data?.spotter_report || null;
      if (state.activeSpotter) localStorage.setItem("parkswap_spotter_report", JSON.stringify(state.activeSpotter));
      spotterModal.classList.add("hidden");
      toast("Spot reported as unverified. ParkSwap will expire it automatically.");
      await loadSpots(false);
    } catch (error) { toast(error.message); }
    finally { setBusy(button, false); }
  }
  async function setupPayouts() {
    const button = $("setupPayoutButton"); setBusy(button, true, "Opening Stripe…");
    try {
      const payload = await api("/v1/payment/account-verification", { method: "PUT" });
      const link = payload?.data?.stripe_account_link?.url || payload?.data?.stripe_account_link;
      if (!link || !/^https:\/\/(connect\.)?stripe\.com\//i.test(String(link))) throw new Error("Secure payout setup is temporarily unavailable.");
      window.location.assign(String(link));
    } catch (error) { toast(error.message); setBusy(button, false); }
  }
  function notifyNewSpot(count) {
    if (Notification.permission === "granted" && document.hidden) new Notification("ParkSwap", { body: `${count} new parking ${count === 1 ? "opportunity" : "opportunities"} nearby.`, icon: "icon-192.png" });
    $("alertBadge").textContent = String(count); $("alertBadge").classList.remove("hidden");
  }
  async function installApp() { if (state.installPrompt) { state.installPrompt.prompt(); await state.installPrompt.userChoice; state.installPrompt = null; $("installButton").classList.add("hidden"); } else { toast(/iphone|ipad|ipod/i.test(navigator.userAgent) ? "On iPhone, tap Share, then Add to Home Screen." : "Use your browser menu and choose Install ParkSwap."); } }
  window.addEventListener("beforeinstallprompt", (event) => { event.preventDefault(); state.installPrompt = event; $("installButton").classList.remove("hidden"); });

  $("lookButton").addEventListener("click", () => setMode(1)); $("leaveButton").addEventListener("click", () => setMode(2)); $("soonButton").addEventListener("click", openScheduleModal); $("stopButton").addEventListener("click", stopMode);
  $("destinationForm").addEventListener("submit", (event) => { event.preventDefault(); exploreDestination($("destinationInput").value, { autoApplySingle: true }); });
  $("destinationInput").addEventListener("input", (event) => {
    clearTimeout(state.destinationSearchTimer);
    state.destinationSearchController?.abort();
    const value = event.currentTarget.value.trim();
    if (value.length < 3) { closeDestinationResults(); return; }
    state.destinationSearchTimer = setTimeout(() => exploreDestination(value, { quiet: true }), 450);
  });
  $("spotterButton").addEventListener("click", reportSpotterOpportunity); $("confirmSpotterButton").addEventListener("click", confirmSpotterOpportunity); $("setupPayoutButton").addEventListener("click", setupPayouts);
  $("recenterButton").addEventListener("click", () => locate({ userInitiated: true })); $("claimButton").addEventListener("click", claimSelected); $("editVehicleButton").addEventListener("click", openVehicleModal);
  $("enableNotifications").addEventListener("click", enableNotifications); $("installButton").addEventListener("click", installApp); $("installFromProfile").addEventListener("click", installApp);
  $("retryLocationButton").addEventListener("click", () => locate({ userInitiated: true }));
  $("chooseLocationButton").addEventListener("click", () => { state.locationRequestId += 1; setBusy($("retryLocationButton"), false); locationModal.classList.add("hidden"); state.manualLocationMode = true; $("map").closest(".map-wrap").classList.add("manual-location"); $("locationStatus").textContent = "Tap the map to choose your location"; showPanel("mapPanel"); refreshMapSize(); toast("Tap your current position on the map."); });
  document.querySelectorAll("[data-close-location]").forEach((el) => el.addEventListener("click", () => {
    state.locationRequestId += 1;
    setBusy($("retryLocationButton"), false);
    locationModal.classList.add("hidden");
    state.pendingAction = null;
    $("locationStatus").textContent = state.exploreCoords ? `Exploring ${state.exploreLabel}` : "Search an address or enable location";
  }));
  $("signOutButton").addEventListener("click", () => signOut()); $("alertsButton").addEventListener("click", () => { $("alertBadge").classList.add("hidden"); showPanel("activityPanel"); });
  document.querySelectorAll('input[name="account_role"]').forEach((input) => input.addEventListener("change", () => setAccountRole(input.value)));
  document.querySelectorAll("[data-close-modal]").forEach((el) => el.addEventListener("click", () => { vehicleModal.classList.add("hidden"); spotModal.classList.add("hidden"); scheduleModal.classList.add("hidden"); spotterModal.classList.add("hidden"); }));
  document.querySelectorAll(".modal-close").forEach((el) => el.addEventListener("click", () => el.closest(".modal").classList.add("hidden")));
  document.querySelectorAll("[data-panel]").forEach((button) => button.addEventListener("click", () => showPanel(button.dataset.panel)));
  window.addEventListener("resize", refreshMapSize);
  window.addEventListener("orientationchange", () => setTimeout(refreshMapSize, 250));
  function showPanel(id) { document.querySelectorAll(".panel").forEach((panel) => panel.classList.toggle("active-panel", panel.id === id)); document.querySelectorAll("[data-panel]").forEach((button) => button.classList.toggle("active", button.dataset.panel === id)); if (id === "mapPanel" && state.map) setTimeout(() => state.map.invalidateSize(), 50); }

  if ("serviceWorker" in navigator) window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
  if (state.token && state.user) enterApp();
})();
