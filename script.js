import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut, sendPasswordResetEmail, reload } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";
import { getFirestore, collection, doc, getDoc, getDocs, addDoc, setDoc, updateDoc, deleteDoc, query, where, serverTimestamp, onSnapshot } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";

// Pegue aquí la configuración de su aplicación web de Firebase.
const firebaseConfig = {
  apiKey: "AIzaSyCmlzCi-jnriEOnpApbjRP63BoCARF5ZGY",
  authDomain: "ppvg-7833f.firebaseapp.com",
  projectId: "ppvg-7833f",
  storageBucket: "ppvg-7833f.firebasestorage.app",
  messagingSenderId: "844663862783",
  appId: "1:844663862783:web:bc8c44fbb66c692584e3ca",
  measurementId: "G-HRWH1K2NKB"
};

const REGIONS = { canas: "Cañas", nicoya: "Nicoya", liberia: "Liberia", santa_cruz: "Santa Cruz" };
const $ = id => document.getElementById(id);
let auth = null, db = null, user = null, profile = null;
let plans = [], assignments = [], tracking = [], regionalUsers = [];
let realtimeUnsubscribers = [];
let realtimeProgress = [];
const MODULES = ["PPVG", "PFP", "Control visitas general", "Control visitas", "Hoja de control"];
const firebaseReady = Object.values(firebaseConfig).every(value => value && !value.startsWith("REEMPLAZAR"));

if (location.protocol === "file:") {
  $("loginMsg").textContent = "Esta aplicación debe abrirse desde un servidor local (por ejemplo, Live Server), no directamente como archivo.";
} else if (firebaseReady) {
  const app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
  onAuthStateChanged(auth, async authenticatedUser => {
    user = authenticatedUser;
    if (!user) { stopRealtimeSync(); profile = null; showLogin(); return; }
    try {
      const profileSnapshot = await getDoc(doc(db, "users", user.uid));
      if (!profileSnapshot.exists()) throw new Error(`No existe users/${user.uid}. Cree el perfil de esta cuenta en Firestore.`);
      profile = profileSnapshot.data();
      if (!['admin', 'regional'].includes(profile.role)) throw new Error('El campo role debe ser "admin" o "regional".');
      if (profile.role === 'regional' && !Object.keys(REGIONS).includes(profile.region)) {
        throw new Error('El perfil regional debe tener region: canas, nicoya, liberia o santa_cruz.');
      }
      await startApp();
    } catch (error) {
      showLogin();
      $("loginMsg").textContent = error.message;
      await signOut(auth);
    }
  });
} else {
  $("loginMsg").textContent = "Configure firebaseConfig en script.js para habilitar el acceso.";
}

function showLogin() { $("login").classList.remove("hide"); $("application").classList.add("hide"); }
function showApp() { $("login").classList.add("hide"); $("application").classList.remove("hide"); }

$("loginForm").addEventListener("submit", async event => {
  event.preventDefault();
  if (!auth) {
    $("loginMsg").textContent = location.protocol === "file:" ? "Abra la aplicación mediante un servidor local (Live Server)." : "Firebase no está inicializado. Revise la configuración y recargue la página.";
    return;
  }
  const button = event.submitter || event.currentTarget.querySelector("button[type=submit]") || event.currentTarget.querySelector("button");
  button.disabled = true; button.textContent = "Validando..."; $("loginMsg").textContent = "";
  try { await signInWithEmailAndPassword(auth, $("email").value.trim(), $("password").value); }
  catch (error) {
    $("loginMsg").textContent = ({
      "auth/invalid-credential": "Correo o contraseña incorrectos.",
      "auth/too-many-requests": "Demasiados intentos. Espere e inténtelo nuevamente.",
      "auth/network-request-failed": "No se pudo conectar a Firebase."
    })[error.code] || "No fue posible iniciar sesión.";
  } finally { button.disabled = false; button.textContent = "Ingresar"; }
});

async function startApp() {
  showApp();
  applySettings();
  const name = profile.displayName || user.email?.split("@")[0] || "Usuario";
  const initials = name.split(/[ ._-]/).filter(Boolean).slice(0, 2).map(part => part[0].toUpperCase()).join("") || "U";
  $("accountName").textContent = name;
  $("accountRole").textContent = profile.role === "admin" ? "Administración" : `Dirección Regional de ${REGIONS[profile.region]}`;
  ["avatar", "headAvatar"].forEach(id => $(id).textContent = initials);
  const regionLabel = profile.role === "admin" ? "Todas las Direcciones Regionales" : `Dirección Regional de ${REGIONS[profile.region]}`;
  $("settingsAccountName").textContent = name;
  $("settingsAccountEmail").textContent = user.email || "Correo no disponible";
  $("settingsAccountRole").textContent = profile.role === "admin" ? "Administración PPVG" : "Cuenta regional";
  $("settingsAccountRegion").textContent = regionLabel;
  $("settingHomePage").querySelector('option[value="admin"]').hidden = profile.role !== "admin";
  loadSettingsControls();

  $("dateNow").textContent = new Date().toLocaleDateString("es-CR", { year: "numeric", month: "long", day: "numeric" });
  const isAdmin = profile.role === "admin";
  document.querySelectorAll(".admin-only").forEach(element => element.classList.toggle("hide", !isAdmin));
  if (isAdmin) {
    await loadRegionalUsers();
    // Restablecer el filtro al entrar con Administración, incluso tras cambiar de cuenta.
    $("regionFilter").disabled = false;
    $("regionFilter").innerHTML = '<option value="all">Todas las direcciones</option>' + Object.entries(REGIONS).map(([key, label]) => `<option value="${key}">${label}</option>`).join("");
    $("regionFilter").value = "all";
    $("trackingSubtitle").textContent = "Vista consolidada de los avances de las cuatro Direcciones Regionales.";
  } else {
    // Limpiar filtro y fijarlo únicamente a la región de la cuenta regional.
    $("regionFilter").innerHTML = `<option value="${profile.region}">${REGIONS[profile.region]}</option>`;
    $("regionFilter").value = profile.region;
    $("regionFilter").disabled = true;
    $("trackingSubtitle").textContent = `Tareas asignadas a la Dirección Regional de ${REGIONS[profile.region]}.`;
  }
  $("headAccountName").textContent = name;
  $("headAccountRole").textContent = profile.role === "admin" ? "Administración" : `Dirección Regional de ${REGIONS[profile.region]}`;
  $("headProfileButton").disabled = profile.role !== "admin";
  $("headProfileButton").setAttribute("aria-label", profile.role === "admin" ? "Abrir ajustes de administración" : "Cuenta actual");
  const preferredPage = getUserSettings().homePage || "home";
  navigate(["admin", "settings"].includes(preferredPage) && !isAdmin ? "home" : preferredPage);
  await loadAll();
  startRealtimeSync();
  if (isAdmin) renderAdminPanel();
}


const DEFAULT_SETTINGS = { density: "comfortable", textSize: "normal", homePage: "home" };
function settingsStorageKey() { return `ppvg_preferences_${user?.uid || "guest"}`; }
function getUserSettings() {
  try { return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(settingsStorageKey()) || "{}") }; }
  catch { return { ...DEFAULT_SETTINGS }; }
}
function saveUserSettings(patch) {
  const next = { ...getUserSettings(), ...patch };
  localStorage.setItem(settingsStorageKey(), JSON.stringify(next));
  applySettings(next);
  return next;
}
function applySettings(settings = getUserSettings()) {
  document.body.classList.toggle("ppvg-compact", settings.density === "compact");
  document.body.classList.toggle("ppvg-large-text", settings.textSize === "large");
}
function loadSettingsControls() {
  const settings = getUserSettings();
  $("settingDensity").value = settings.density;
  $("settingTextSize").value = settings.textSize;
  $("settingHomePage").value = settings.homePage;
  applySettings(settings);
}
$("settingDensity").addEventListener("change", event => { saveUserSettings({ density: event.target.value }); showToast("Densidad de interfaz actualizada."); });
$("settingTextSize").addEventListener("change", event => { saveUserSettings({ textSize: event.target.value }); showToast("Tamaño de texto actualizado."); });
$("settingHomePage").addEventListener("change", event => { saveUserSettings({ homePage: event.target.value }); showToast("Página inicial guardada para el próximo ingreso."); });
$("settingsResetPreferences").addEventListener("click", () => {
  localStorage.removeItem(settingsStorageKey()); loadSettingsControls(); showToast("Se restablecieron las preferencias de esta cuenta.");
});
$("settingsResetPassword").addEventListener("click", async () => {
  if (!user?.email) { showToast("La cuenta no tiene un correo disponible."); return; }
  const button = $("settingsResetPassword"); button.disabled = true;
  try { await sendPasswordResetEmail(auth, user.email); showToast(`Enviamos instrucciones a ${user.email}.`); }
  catch (error) { console.error(error); showToast(error.code === "auth/too-many-requests" ? "Demasiados intentos. Inténtalo más tarde." : "No se pudo enviar el correo de recuperación."); }
  finally { button.disabled = false; }
});
$("settingsRefreshData").addEventListener("click", async () => {
  const button = $("settingsRefreshData"); button.disabled = true;
  try { await loadAll(); $("settingsLastSync").textContent = new Date().toLocaleTimeString("es-CR", {hour:"2-digit", minute:"2-digit"}); showToast("Se consultaron nuevamente los datos de Firestore."); }
  catch (error) { console.error(error); showToast("No fue posible actualizar los datos."); }
  finally { button.disabled = false; }
});
$("settingsLogout").addEventListener("click", () => $("logout").click());
$("settingsGoAdmin").addEventListener("click", () => navigate("admin"));
function updateSyncStatus(state, message = "") {
  const dot = $("settingsSyncDot"); if (!dot) return;
  dot.classList.toggle("is-error", state === "error");
  dot.classList.toggle("is-live", state === "live");
  $("settingsSyncTitle").textContent = state === "live" ? "Sincronización activa" : state === "error" ? "Problema de sincronización" : "Conectando…";
  $("settingsSyncDescription").textContent = message || (state === "live" ? "Firestore está enviando actualizaciones automáticamente." : state === "error" ? "Revise la conexión y los permisos de Firestore." : "Esperando confirmación de Firestore.");
  if (state === "live") $("settingsLastSync").textContent = new Date().toLocaleTimeString("es-CR", {hour:"2-digit", minute:"2-digit"});
}

function navigate(page) {
  // Las secciones administrativas nunca deben abrirse desde una cuenta regional.
  if (["admin", "settings"].includes(page) && profile?.role !== "admin") page = "home";
  document.querySelectorAll(".page").forEach(element => element.classList.remove("active"));
  const target = $("page-" + page); if (!target) return; target.classList.add("active");
  document.querySelectorAll(".nav").forEach(button => {
    const active = button.dataset.page === page;
    button.classList.toggle("active", active);
    if (active) button.setAttribute("aria-current", "page"); else button.removeAttribute("aria-current");
  });
  $("crumb").textContent = ({ home: "Inicio", plans: "PPVG", tracking: "Seguimiento de PPVG", settings: "Ajustes", admin: "Administración" })[page];
  setSidebarOpen(false);
}
document.querySelectorAll(".nav").forEach(button => button.addEventListener("click", () => navigate(button.dataset.page)));
document.querySelectorAll("[data-go]").forEach(button => button.addEventListener("click", () => navigate(button.dataset.go)));
$("headProfileButton").addEventListener("click", () => { if (profile?.role === "admin") navigate("settings"); });
$("adminGoPlans")?.addEventListener("click", () => navigate("plans"));
$("adminGoTracking")?.addEventListener("click", () => navigate("tracking"));
$("adminRefresh")?.addEventListener("click", () => { loadAll().then(() => showToast("Datos sincronizados.")); });
$("adminExportCsv")?.addEventListener("click", exportAdminCsv);
$("adminBackupJson")?.addEventListener("click", exportAdminJson);
function setSidebarOpen(open) {
  $("sidebar").classList.toggle("open", open);
  $("sidebarBackdrop").classList.toggle("visible", open);
  $("menu").setAttribute("aria-expanded", String(open));
  $("menu").setAttribute("aria-label", open ? "Cerrar menú de navegación" : "Abrir menú de navegación");
  document.body.classList.toggle("sidebar-is-open", open);
}
$("menu").onclick = () => setSidebarOpen(!$("sidebar").classList.contains("open"));
$("sidebarBackdrop").onclick = () => setSidebarOpen(false);
document.addEventListener("keydown", event => { if (event.key === "Escape") setSidebarOpen(false); });
window.addEventListener("resize", () => { if (window.innerWidth > 760) setSidebarOpen(false); });
$("logout").onclick = async () => {
  stopRealtimeSync();
  // Evita que filtros de la sesión anterior queden visualmente activos al cambiar de cuenta.
  if ($("regionFilter")) { $("regionFilter").disabled = false; $("regionFilter").value = "all"; }
  if ($("moduleFilter")) $("moduleFilter").value = "all";
  const search = $("trackingSearch"); if (search) search.value = "";
  await signOut(auth);
};
document.querySelectorAll("[data-close]").forEach(button => button.addEventListener("click", () => button.closest(".modal").classList.add("hide")));
document.addEventListener("keydown", event => { if (event.key === "Escape") document.querySelectorAll(".modal:not(.hide)").forEach(modal => modal.classList.add("hide")); });

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}
function showToast(message) {
  $("toast").textContent = message; $("toast").classList.add("show");
  setTimeout(() => $("toast").classList.remove("show"), 3200);
}
function assignmentId(planId, region) { return `${planId}_${region}`; }

async function loadRegionalUsers() {
  try {
    const snapshot = await getDocs(query(collection(db, "users"), where("role", "==", "regional")));
    regionalUsers = snapshot.docs.map(item => ({ id: item.id, ...item.data() }));
  } catch (error) { console.warn("No se pudo cargar el directorio regional", error); regionalUsers = []; }
}

async function loadAll() {
  try {
    const [planSnapshot, assignmentSnapshot] = await Promise.all([
      getDocs(collection(db, "ppvgPlans")),
      profile.role === "admin"
        ? getDocs(collection(db, "ppvgAssignments"))
        : getDocs(query(collection(db, "ppvgAssignments"), where("region", "==", profile.region)))
    ]);
    plans = planSnapshot.docs.map(item => ({ id: item.id, ...item.data() }));
    assignments = assignmentSnapshot.docs.map(item => ({ id: item.id, ...item.data() }));
    renderPlans();
    await loadTracking();
  } catch (error) {
    console.error(error);
    showToast("No se pudieron cargar los datos. Revise las reglas de Firestore.");
    $("plansBody").innerHTML = '<div class="empty-state"><strong>No fue posible cargar PPVG</strong><p>Verifique la conexión y las reglas de seguridad de Firestore.</p></div>';
    $("trackingBody").innerHTML = '<div class="empty-state"><strong>No fue posible cargar el seguimiento</strong><p>Verifique la conexión y los permisos de Firestore.</p></div>';
  }
}

function renderPlans() {
  const search = $("planSearch").value.toLowerCase().trim();
  const filtered = plans.filter(plan => [plan.area, plan.strategic, plan.goal, plan.strategicIndicator, plan.objective, plan.indicator, plan.quantity, plan.activity, plan.period, plan.responsible, plan.module].some(value => String(value || "").toLowerCase().includes(search)));
  $("planCount").textContent = `${filtered.length} ${filtered.length === 1 ? "registro" : "registros"}`;
  $("plansBody").innerHTML = filtered.length ? `<table class="planning-table compact-planning"><thead><tr><th class="row-num">#</th><th>Área estratégica</th><th>Actividad</th><th>Objetivo / producto</th><th>Detalles</th></tr></thead><tbody>${filtered.map((plan,index) => `<tr class="planning-row"><td class="row-num">${index+1}</td><td class="cell-area">${escapeHTML(plan.area || "—")}<span class="sheet-module">${escapeHTML(plan.module || plan.planModule || "PPVG")}</span></td><td class="cell-activity">${escapeHTML(plan.activity || "—")}</td><td class="cell-objective">${escapeHTML(plan.objective || "—")}</td><td class="sheet-actions"><button class="sheet-more detail-button" type="button" data-sheet-details="${escapeHTML(plan.id)}">Ver detalles</button></td></tr>`).join("")}</tbody></table>` : '<div class="empty-state"><strong>No se encontraron tareas</strong><p>Pruebe con otro término o revise la planificación registrada.</p></div>';
  document.querySelectorAll("[data-sheet-details]").forEach(button => button.addEventListener("click", () => openPlanDetails(button.dataset.sheetDetails)));
}
function openPlanDetails(id) {
  const plan = plans.find(item => item.id === id); if (!plan) return;
  const regionItems = assignments.filter(item => item.planId === id);
  const regions = regionItems.map(item => REGIONS[item.region] || item.region);
  const regionTags = regions.length ? regions.map(name => `<span class="sheet-chip">${escapeHTML(name)}</span>`).join(" ") : `<span class="sheet-chip muted">Sin asignar</span>`;
  const detailFields = [
    ["Área estratégica del POA",plan.area], ["Objetivo específico / producto",plan.objective], ["Objetivos estratégicos",plan.strategic],
    ["Indicador",plan.indicator], ["Indicador estratégico",plan.strategicIndicator], ["Cantidad de actividades",plan.quantity],
    ["Meta numérica",plan.goal], ["Período de ejecución",plan.period], ["Responsables",plan.responsible]
  ];
  let drawer=document.getElementById("planDetailsDrawer"); if(!drawer){drawer=document.createElement("div");drawer.id="planDetailsDrawer";document.body.appendChild(drawer);}
  drawer.innerHTML=`<div class="detail-backdrop" data-close-drawer></div><aside class="detail-drawer"><div class="drawer-top"><div><span class="sheet-module">${escapeHTML(plan.module || plan.planModule || "PPVG")}</span><h2>${escapeHTML(plan.activity || "Actividad sin título")}</h2></div><button type="button" class="drawer-close" data-close-drawer aria-label="Cerrar">×</button></div><div class="drawer-content"><section class="drawer-section"><h3>Identificación</h3><div class="drawer-grid">${detailFields.slice(0,3).map(([label,value])=>`<div class="drawer-field"><label>${label}</label><p>${escapeHTML(value || "—")}</p></div>`).join("")}</div></section><section class="drawer-section"><h3>Indicadores y metas</h3><div class="drawer-grid">${detailFields.slice(3,7).map(([label,value])=>`<div class="drawer-field"><label>${label}</label><p>${escapeHTML(value ?? "—")}</p></div>`).join("")}</div></section><section class="drawer-section"><h3>Ejecución</h3><div class="drawer-grid">${detailFields.slice(7).map(([label,value])=>`<div class="drawer-field"><label>${label}</label><p>${escapeHTML(value || "—")}</p></div>`).join("")}</div></section><section class="drawer-section"><h3>Asignación</h3><div class="drawer-field"><label>Direcciones Regionales</label><div>${regionTags}</div></div><div class="drawer-field"><label>Personas asignadas</label><p>${escapeHTML(regionItems.flatMap(item=>item.targetUserNames||[]).filter(Boolean).join(", ") || "Asignación por Dirección Regional")}</p></div></section></div><div class="drawer-footer">${profile.role === "admin" ? `<button class="primary-btn" type="button" data-drawer-edit="${escapeHTML(plan.id)}">Editar planeamiento</button>` : ""}</div></aside>`;
  drawer.classList.add("open"); drawer.querySelectorAll("[data-close-drawer]").forEach(el=>el.addEventListener("click",()=>drawer.classList.remove("open"))); const edit=drawer.querySelector("[data-drawer-edit]");if(edit)edit.addEventListener("click",()=>{drawer.classList.remove("open");editPlan(id);});
}
$("planSearch").addEventListener("input", renderPlans);

function renderRegionChoices(selected = []) {
  $("assignmentBuilder").innerHTML = Object.entries(REGIONS).map(([key, label]) => `
    <label class="region-choice"><input type="checkbox" value="${key}" ${selected.includes(key) ? "checked" : ""}><span>${label}</span></label>`).join("");
}
function resetPlanForm() {
  $("planForm").reset(); $("planId").value = ""; $("planModule").value = "PPVG"; renderRegionChoices(); renderPeopleChoices();
  $("planMsg").textContent = ""; $("planModalTitle").textContent = "Nueva tarea PPVG";
}
$("newPlan").onclick = () => { resetPlanForm(); $("planModal").classList.remove("hide"); };
function renderPeopleChoices(selected = {}) {
  const box = $("peopleAssignment");
  if (!box) return;
  const checkedRegions = [...$("assignmentBuilder").querySelectorAll("input:checked")].map(input => input.value);
  if (!checkedRegions.length) { box.innerHTML = '<p class="people-help">Seleccione primero una Dirección Regional para ver sus personas.</p>'; return; }
  const relevant = regionalUsers.filter(person => checkedRegions.includes(person.region));
  if (!relevant.length) { box.innerHTML = '<p class="people-help">No se encontraron cuentas regionales en el directorio de usuarios. Si no selecciona personas, la tarea se asignará a toda la Dirección.</p>'; return; }
  const selectedIds = selected.ids || [];
  box.innerHTML = `<div class="people-head"><b>👥 Destinatarios específicos (opcional)</b><small>Si deja esto vacío, la tarea queda asignada a toda la dirección seleccionada.</small></div>` +
    relevant.map(person => `<label class="person-choice"><input type="checkbox" value="${escapeHTML(person.id)}" ${selectedIds.includes(person.id) ? "checked" : ""}><span><b>${escapeHTML(person.displayName || person.name || person.email || "Cuenta regional")}</b><small>${escapeHTML(REGIONS[person.region] || person.region || "Dirección")}${person.email ? ` · ${escapeHTML(person.email)}` : ""}</small></span></label>`).join("");
}
$("assignmentBuilder").addEventListener("change", () => { const ids = [...$("peopleAssignment").querySelectorAll("input:checked")].map(input => input.value); renderPeopleChoices({ ids }); });

function editPlan(id) {
  const plan = plans.find(item => item.id === id); if (!plan) return;
  resetPlanForm(); $("planModalTitle").textContent = "Editar tarea PPVG"; $("planId").value = id; $("planModule").value = plan.module || "PPVG";
  const fields = ["area", "strategic", "goal", "strategicIndicator", "objective", "indicator", "quantity", "activity", "period", "responsible"];
  fields.forEach(field => $(field).value = plan[field] ?? "");
  renderRegionChoices(assignments.filter(item => item.planId === id).map(item => item.region));
  renderPeopleChoices({ ids: [...new Set(assignments.filter(item => item.planId === id).flatMap(item => item.targetUserIds || []))] });
  $("planModal").classList.remove("hide");
}

$("planForm").addEventListener("submit", async event => {
  event.preventDefault();
  const id = $("planId").value;
  const selectedRegions = [...$("assignmentBuilder").querySelectorAll("input:checked")].map(input => input.value);
  const targetUserIds = [...$("peopleAssignment").querySelectorAll("input:checked")].map(input => input.value);
  const module = $("planModule").value;
  if (!selectedRegions.length) { $("planMsg").textContent = "Seleccione al menos una Dirección Regional para dar seguimiento."; return; }
  const data = {
    module, area: $("area").value.trim(), strategic: $("strategic").value.trim(), goal: Number($("goal").value || 0),
    strategicIndicator: $("strategicIndicator").value.trim(), objective: $("objective").value.trim(),
    indicator: $("indicator").value.trim(), quantity: Number($("quantity").value || 0), activity: $("activity").value.trim(),
    period: $("period").value.trim(), responsible: $("responsible").value.trim(), updatedAt: serverTimestamp(), updatedBy: user.uid
  };
  const button = $("savePlan"); button.disabled = true; button.textContent = "Guardando...";
  try {
    let planId = id;
    if (id) await updateDoc(doc(db, "ppvgPlans", id), data);
    else {
      const reference = await addDoc(collection(db, "ppvgPlans"), { ...data, createdAt: serverTimestamp(), createdBy: user.uid });
      planId = reference.id;
    }
    const previousAssignments = assignments.filter(item => item.planId === planId);
    for (const region of selectedRegions) {
      await setDoc(doc(db, "ppvgAssignments", assignmentId(planId, region)), {
        planId, region, regionName: REGIONS[region], module, targetedToSpecificPeople: targetUserIds.length > 0, targetUserIds: targetUserIds.filter(uid => regionalUsers.find(person => person.id === uid)?.region === region), targetUserNames: targetUserIds.map(uid => regionalUsers.find(person => person.id === uid)?.displayName || regionalUsers.find(person => person.id === uid)?.name || "").filter(Boolean), goal: data.quantity, activity: data.activity,
        objective: data.objective, updatedAt: serverTimestamp(), updatedBy: user.uid
      }, { merge: true });
    }
    for (const previous of previousAssignments) {
      if (!selectedRegions.includes(previous.region)) await deleteDoc(doc(db, "ppvgAssignments", previous.id));
    }
    $("planModal").classList.add("hide"); showToast(id ? "Tarea actualizada y sincronizando" : "Tarea creada y asignada");
  } catch (error) {
    console.error(error); $("planMsg").textContent = error.message || "No se pudo guardar. Revise los permisos de Firestore.";
  } finally { button.disabled = false; button.textContent = "Guardar tarea"; }
});

function stopRealtimeSync() { realtimeUnsubscribers.forEach(unsubscribe => { try { unsubscribe(); } catch {} }); realtimeUnsubscribers = []; }
function startRealtimeSync() {
  stopRealtimeSync();
  if (!db || !user || !profile) return;
  const assignmentsRef = profile.role === "admin" ? collection(db, "ppvgAssignments") : query(collection(db, "ppvgAssignments"), where("region", "==", profile.region));
  const trackingRef = profile.role === "admin" ? collection(db, "ppvgTracking") : query(collection(db, "ppvgTracking"), where("region", "==", profile.region));
  let plansReady = false, assignmentsReady = false, trackingReady = false;
  const refresh = () => {
    if (!plansReady || !assignmentsReady || !trackingReady) return;
    updateSyncStatus("live");
    const progressById = new Map(realtimeProgress.map(row => [row.id, row]));
    tracking = assignments.map(assignment => ({ ...assignment, ...(progressById.get(assignment.id) || { periodOne: 0, periodTwo: 0, notes: "" }) }));
    renderPlans(); renderTracking();
    if (profile.role === "admin") renderAdminPanel();
  };
  realtimeUnsubscribers.push(onSnapshot(collection(db, "ppvgPlans"), snapshot => {
    plans = snapshot.docs.map(item => ({ id: item.id, ...item.data() })); plansReady = true; refresh();
  }, error => { console.error("Realtime ppvgPlans", error); updateSyncStatus("error", "No se pudo sincronizar la planificación."); showToast("No se pudo sincronizar la planificación."); }));
  realtimeUnsubscribers.push(onSnapshot(assignmentsRef, snapshot => {
    assignments = snapshot.docs.map(item => ({ id: item.id, ...item.data() })); assignmentsReady = true; refresh();
  }, error => { console.error("Realtime ppvgAssignments", error); updateSyncStatus("error", "No se pudieron sincronizar las asignaciones."); showToast("No se pudieron sincronizar las asignaciones."); }));
  realtimeUnsubscribers.push(onSnapshot(trackingRef, snapshot => {
    realtimeProgress = snapshot.docs.map(item => ({ id: item.id, ...item.data() })); trackingReady = true; refresh();
  }, error => { console.error("Realtime ppvgTracking", error); updateSyncStatus("error", "No se pudieron sincronizar los avances."); showToast("No se pudieron sincronizar los avances."); }));
}

function getAdminTaskStatus(item) {
  const goal = Number(item.goal || 0);
  const completedAmount = Number(item.periodOne || 0) + Number(item.periodTwo || 0);
  if (goal > 0 && completedAmount >= goal) return "completed";
  if (completedAmount <= 0) return "pending";
  return "inProgress";
}

function renderAdminPanel() {
  if (profile?.role !== "admin") return;

  const progressById = new Map(realtimeProgress.map(row => [row.id, row]));
  const rows = assignments.map(assignment => ({
    ...assignment,
    ...(progressById.get(assignment.id) || { periodOne: 0, periodTwo: 0, notes: "" })
  }));
  const counts = rows.reduce((result, item) => {
    result[getAdminTaskStatus(item)] += 1;
    result.goal += Number(item.goal || 0);
    result.achieved += Number(item.periodOne || 0) + Number(item.periodTwo || 0);
    return result;
  }, { pending: 0, inProgress: 0, completed: 0, goal: 0, achieved: 0 });

  $("adminPlanCount").textContent = plans.length;
  $("adminAssignmentCount").textContent = assignments.length;
  $("adminPendingCount").textContent = counts.pending;
  $("adminInProgressCount").textContent = counts.inProgress;
  $("adminCompletedCount").textContent = counts.completed;
  $("adminProgressCount").textContent = realtimeProgress.length;
  $("adminUserCount").textContent = regionalUsers.length;
  $("adminOverallProgress").textContent = percentage(counts.achieved, counts.goal) + "%";

  $("adminRegionOverview").innerHTML = Object.entries(REGIONS).map(([key, label]) => {
    const regionalRows = rows.filter(row => row.region === key);
    const regionalCounts = regionalRows.reduce((result, item) => {
      result[getAdminTaskStatus(item)] += 1;
      result.goal += Number(item.goal || 0);
      result.achieved += Number(item.periodOne || 0) + Number(item.periodTwo || 0);
      return result;
    }, { pending: 0, inProgress: 0, completed: 0, goal: 0, achieved: 0 });
    const rate = percentage(regionalCounts.achieved, regionalCounts.goal);
    return `<article class="admin-region-row">
      <div class="admin-region-mark">${escapeHTML(label.slice(0,1))}</div>
      <div class="admin-region-info">
        <b>${escapeHTML(label)}</b>
        <small>${regionalRows.length} asignadas · ${regionalCounts.completed} finalizadas · ${regionalCounts.pending} pendientes · ${regionalCounts.inProgress} en proceso</small>
        <div class="admin-region-track"><i style="width:${Math.min(rate,100)}%"></i></div>
      </div>
      <strong>${rate}%</strong>
    </article>`;
  }).join("");
}
function downloadBlob(content, filename, type) {
  const blob = new Blob([content], { type }); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = filename; a.click(); URL.revokeObjectURL(url);
}
function exportAdminCsv() {
  if (profile?.role !== "admin") return;
  const columns = ["Tarea","Encargado","Direccion Regional","Meta","Periodo I","Periodo II","Avance anual","Observaciones","Responsables","Periodo ejecucion"];
  const rows = tracking.map(row => [row.activity,row.module,REGIONS[row.region] || row.region,row.goal,row.periodOne || 0,row.periodTwo || 0,Number(row.periodOne || 0)+Number(row.periodTwo || 0),row.notes,row.responsible,row.period]);
  const csv = [columns,...rows].map(row => row.map(value => `"${String(value ?? "").replace(/"/g,'""')}"`).join(";")).join("\r\n");
  downloadBlob("\ufeff"+csv, `PPVG_reporte_${new Date().toISOString().slice(0,10)}.csv`, "text/csv;charset=utf-8"); showToast("Reporte CSV descargado.");
}
function exportAdminJson() {
  if (profile?.role !== "admin") return;
  const backup = { exportedAt: new Date().toISOString(), exportedBy: user.uid, plans, assignments, tracking, regionalUsers };
  downloadBlob(JSON.stringify(backup,null,2), `PPVG_respaldo_${new Date().toISOString().slice(0,10)}.json`, "application/json"); showToast("Respaldo JSON descargado.");
}

async function loadTracking() {
  const snapshot = profile.role === "admin"
    ? await getDocs(collection(db, "ppvgAssignments"))
    : await getDocs(query(collection(db, "ppvgAssignments"), where("region", "==", profile.region)));
  const rows = await Promise.all(snapshot.docs.map(async assignmentDoc => {
    const assignment = { id: assignmentDoc.id, ...assignmentDoc.data() };
    const progressSnapshot = await getDoc(doc(db, "ppvgTracking", assignment.id));
    return { ...assignment, ...(progressSnapshot.exists() ? progressSnapshot.data() : { periodOne: 0, periodTwo: 0, notes: "" }) };
  }));
  tracking = rows;
  const moduleSelect = $("moduleFilter");
  const currentModule = moduleSelect.value || "all";
  const modules = [...new Set(rows.map(row => row.module || "PPVG"))].sort();
  moduleSelect.innerHTML = '<option value="all">Todos los encargados</option>' + modules.map(m => `<option value="${escapeHTML(m)}">${escapeHTML(m)}</option>`).join("");
  if (modules.includes(currentModule)) moduleSelect.value = currentModule;
  renderTracking();
}

$("regionFilter").addEventListener("change", renderTracking);
$("moduleFilter").addEventListener("change", renderTracking);
$("trackingSearch")?.addEventListener("input", renderTracking);
function percentage(value, goal) { return goal > 0 ? Math.round(value / goal * 100) : 0; }
function renderTracking() {
  const selectedRegion = $("regionFilter").value;
  const selectedModule = $("moduleFilter").value;
  let rows = tracking.filter(item => profile.role !== "admin" ? (item.region === profile.region && (!item.targetedToSpecificPeople || (item.targetUserIds || []).includes(user.uid))) : (selectedRegion === "all" || item.region === selectedRegion));
  if (selectedModule !== "all") rows = rows.filter(item => (item.module || "PPVG") === selectedModule);
  const search = ($("trackingSearch")?.value || "").toLowerCase().trim();
  if (search) rows = rows.filter(item => [item.activity, item.objective, item.regionName, REGIONS[item.region]].some(value => String(value || "").toLowerCase().includes(search)));
  const totals = rows.reduce((sum, item) => {
    sum.goal += Number(item.goal || 0); sum.one += Number(item.periodOne || 0); sum.two += Number(item.periodTwo || 0); return sum;
  }, { goal: 0, one: 0, two: 0 });
  $("assignedCount").textContent = rows.length;
  $("firstProgress").textContent = percentage(totals.one, totals.goal) + "%";
  $("secondProgress").textContent = percentage(totals.two, totals.goal) + "%";
  $("annualProgress").textContent = percentage(totals.one + totals.two, totals.goal) + "%";
  if ($("trackingCount")) $("trackingCount").textContent = `${rows.length} ${rows.length === 1 ? "actividad" : "actividades"}`;
  const renderTrackingCard = item => {
    const one = Number(item.periodOne || 0), two = Number(item.periodTwo || 0), goal = Number(item.goal || 0), annual = one + two;
    const canEdit = profile.role === "admin" || item.region === profile.region;
    const p1 = percentage(one, goal), p2 = percentage(two, goal), pa = percentage(annual, goal);
    return `<article class="tracking-card">
      <div class="tracking-card-top">
        <div><span class="eyebrow">${escapeHTML(REGIONS[item.region] || item.region)} · META ${goal}</span>
          <h3>${escapeHTML(item.activity || "Actividad sin título")}</h3>
          <p class="tracking-objective">${escapeHTML(item.objective || "Sin objetivo específico registrado.")}</p>
          <div class="tracking-meta"><span class="tag tag-blue">${goal} actividades previstas</span><span class="tag ${pa >= 100 ? "tag-green" : "tag-muted"}">${pa}% de avance anual</span></div>
        </div>
        <div class="tracking-card-actions">${canEdit ? `<button class="action" type="button" data-progress="${escapeHTML(item.id)}">${profile.role === "admin" ? "Consultar avance" : "Registrar avance"}</button>` : ""}</div>
      </div>
      <div class="progress-grid">
        <div class="progress-metric"><div class="progress-metric-head"><span>I PERÍODO</span><b>${p1}%</b></div><div class="progress-track"><div class="progress-fill" style="width:${Math.min(p1,100)}%"></div></div><div class="progress-foot">${one} de ${goal} actividades</div></div>
        <div class="progress-metric"><div class="progress-metric-head"><span>II PERÍODO</span><b>${p2}%</b></div><div class="progress-track"><div class="progress-fill" style="width:${Math.min(p2,100)}%"></div></div><div class="progress-foot">${two} de ${goal} actividades</div></div>
        <div class="progress-metric annual"><div class="progress-metric-head"><span>RESULTADO ANUAL</span><b>${pa}%</b></div><div class="progress-track"><div class="progress-fill" style="width:${Math.min(pa,100)}%"></div></div><div class="progress-foot">${annual} de ${goal} actividades acumuladas</div></div>
      </div>
      <div class="tracking-card-bottom"><small><b>Observaciones:</b> ${escapeHTML(item.notes || "Sin observaciones registradas.")}</small><small>Actualizado por la Dirección Regional correspondiente</small></div>
    </article>`;
  };
  if (!rows.length) {
    $("trackingBody").innerHTML = '<div class="empty-state"><strong>No hay actividades para mostrar</strong><p>Las tareas asignadas aparecerán aquí. Puede cambiar los filtros o consultar con Administración si esperaba ver alguna actividad.</p></div>';
  } else if (profile.role === "admin" && selectedRegion === "all") {
    const grouped = Object.keys(REGIONS).map(regionKey => ({ regionKey, items: rows.filter(item => item.region === regionKey) })).filter(group => group.items.length);
    $("trackingBody").innerHTML = grouped.map(group => `<section class="tracking-region-group"><div class="tracking-region-heading"><div><small>DIRECCIÓN REGIONAL</small><h2>${escapeHTML(REGIONS[group.regionKey])}</h2></div><span>${group.items.length} ${group.items.length === 1 ? "actividad" : "actividades"}</span></div>${group.items.map(renderTrackingCard).join("")}</section>`).join("");
  } else {
    $("trackingBody").innerHTML = rows.map(renderTrackingCard).join("");
  }
  document.querySelectorAll("[data-progress]").forEach(button => button.addEventListener("click", () => editProgress(button.dataset.progress)));
}
function editProgress(id) {
  const item = tracking.find(row => row.id === id); if (!item) return;
  const plan = plans.find(row => row.id === item.planId) || {};
  const value = (key, fallback = "—") => {
    const result = plan[key] ?? item[key];
    return result === undefined || result === null || result === "" ? fallback : result;
  };
  const detailFields = [
    ["Encargado", value("module", "PPVG")],
    ["Área estratégica del POA regional", value("area")],
    ["Objetivos estratégicos", value("strategic")],
    ["Meta numérica", value("goal", item.goal ?? 0)],
    ["Indicador estratégico", value("strategicIndicator")],
    ["Objetivo específico o del producto", value("objective")],
    ["Indicador", value("indicator")],
    ["Cantidad de actividades", value("quantity")],
    ["Período de ejecución", value("period")],
    ["Actividad", value("activity", item.activity || "—")],
    ["Responsables", value("responsible")],
    ["Dirección Regional asignada", REGIONS[item.region] || item.region || "—"]
  ];
  $("progressId").value = id;
  $("progressActivity").textContent = `${item.activity || "Actividad"} · ${REGIONS[item.region] || item.region || "Dirección Regional"}`;
  $("progressTaskDetails").innerHTML = `<div class="progress-details-heading"><div><span>INFORMACIÓN DE LA TAREA</span><h3>Detalle del planeamiento asignado</h3></div><span class="progress-details-badge">PPVG · 2027</span></div><div class="progress-details-grid">${detailFields.map(([label, content]) => `<div class="progress-detail-item"><small>${escapeHTML(label)}</small><p>${escapeHTML(content)}</p></div>`).join("")}</div>`;
  $("progressGoal").value = item.goal ?? plan.quantity ?? plan.goal ?? 0;
  $("progressOne").value = item.periodOne || 0; $("progressTwo").value = item.periodTwo || 0;
  $("progressNotes").value = item.notes || ""; $("progressMsg").textContent = "";
  const readOnly = profile.role === "admin";
  ["progressOne", "progressTwo", "progressNotes"].forEach(field => $(field).disabled = readOnly);
  $("progressForm").querySelector("button.primary").classList.toggle("hide", readOnly);
  updatePreview(); $("progressModal").classList.remove("hide");
}
function updatePreview() {
  const goal = Math.max(0, Number($("progressGoal").value) || 0);
  const one = Math.max(0, Number($("progressOne").value) || 0);
  const two = Math.max(0, Number($("progressTwo").value) || 0);
  const total = one + two, remaining = Math.max(0, goal - total);
  const p1 = percentage(one, goal), p2 = percentage(two, goal), pa = percentage(total, goal);
  $("calcPreview").textContent = `I período: ${p1}% · II período: ${p2}% · Anual: ${pa}%`;
  if ($("progressEntered")) $("progressEntered").textContent = `${total} / ${goal}`;
  if ($("progressRemaining")) $("progressRemaining").textContent = remaining;
  if ($("progressEntryFill")) $("progressEntryFill").style.width = `${Math.min(pa,100)}%`;
  [["progressOnePercent",p1],["progressTwoPercent",p2],["progressAnnualPercent",pa]].forEach(([id,val])=>{if($(id))$(id).textContent=`${val}%`;});
  [["progressOneFill",p1],["progressTwoFill",p2],["progressAnnualFill",pa]].forEach(([id,val])=>{if($(id))$(id).style.width=`${Math.min(val,100)}%`;});
  const over = total > goal;
  if ($("progressLimitHint")) {
    $("progressLimitHint").textContent = over ? `Se excede la meta por ${total-goal}. Ajuste los valores para poder guardar.` : `Puede registrar ${remaining} actividad${remaining===1?"":"es"} más entre ambos períodos. El total no puede superar la meta.`;
    $("progressLimitHint").classList.toggle("over-limit",over);
  }
  // Mantiene el límite disponible del otro período como guía del control numérico.
  $("progressOne").max = String(Math.max(0,goal-two));
  $("progressTwo").max = String(Math.max(0,goal-one));
  const save = $("progressForm").querySelector("button.primary");
  if(save && profile.role === "regional") save.disabled = over;
}
// Los campos de avance aceptan exclusivamente dígitos: bloquea teclas no numéricas
// y limpia también el contenido pegado o introducido desde teclados móviles.
["progressOne", "progressTwo"].forEach(id => {
  const field = $(id);
  field.addEventListener("beforeinput", event => {
    if (event.inputType.startsWith("insert") && event.data !== null && /\D/.test(event.data)) {
      event.preventDefault();
    }
  });
  field.addEventListener("input", () => {
    const cleanValue = field.value.replace(/\D/g, "");
    if (field.value !== cleanValue) field.value = cleanValue;
    updatePreview();
  });
});
$("progressForm").addEventListener("submit", async event => {
  event.preventDefault();
  const id = $("progressId").value, item = tracking.find(row => row.id === id); if (!item || profile.role !== "regional") return;
  const oneText = $("progressOne").value, twoText = $("progressTwo").value;
  if (!/^\d+$/.test(oneText) || !/^\d+$/.test(twoText)) {
    $("progressMsg").textContent = "Ingrese únicamente números enteros, sin letras, espacios ni símbolos.";
    return;
  }
  const one = Number(oneText), two = Number(twoText);
  if (!Number.isSafeInteger(one) || !Number.isSafeInteger(two)) { $("progressMsg").textContent = "Ingrese una cantidad numérica válida."; return; }
  if (one + two > Number(item.goal || 0)) { $("progressMsg").textContent = "La suma de los logros no puede superar la meta asignada."; return; }
  const data = { assignmentId: id, planId: item.planId, region: item.region, goal: Number(item.goal || 0), activity: item.activity, objective: item.objective || "", periodOne: one, periodTwo: two, notes: $("progressNotes").value.trim(), updatedAt: serverTimestamp(), updatedBy: user.uid };
  try {
    await setDoc(doc(db, "ppvgTracking", id), data, { merge: true });
    $("progressModal").classList.add("hide"); showToast("Seguimiento actualizado correctamente");
  } catch (error) { console.error(error); $("progressMsg").textContent = "No se pudo guardar. Verifique las reglas de Firestore."; }
});
