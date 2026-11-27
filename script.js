import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";
import { getFirestore, collection, doc, getDoc, getDocs, addDoc, setDoc, updateDoc, deleteDoc, query, where, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";

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
    if (!user) { showLogin(); return; }
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
  const name = profile.displayName || user.email?.split("@")[0] || "Usuario";
  const initials = name.split(/[ ._-]/).filter(Boolean).slice(0, 2).map(part => part[0].toUpperCase()).join("") || "U";
  $("accountName").textContent = name;
  $("accountRole").textContent = profile.role === "admin" ? "Administración" : `Dirección Regional de ${REGIONS[profile.region]}`;
  ["avatar", "headAvatar", "profileAvatar"].forEach(id => $(id).textContent = initials);
  $("profileName").textContent = name;
  $("profileEmail").textContent = user.email || "—";
  $("profileRole").textContent = profile.role === "admin" ? "Administración" : "Cuenta regional";
  $("profileRegion").textContent = profile.role === "admin" ? "Todas las direcciones" : REGIONS[profile.region];
  $("profileUid").textContent = user.uid;
  $("dateNow").textContent = new Date().toLocaleDateString("es-CR", { year: "numeric", month: "long", day: "numeric" });
  const isAdmin = profile.role === "admin";
  document.querySelectorAll(".admin-only").forEach(element => element.classList.toggle("hide", !isAdmin));
  if (isAdmin) {
    await loadRegionalUsers();
    $("regionFilter").innerHTML = '<option value="all">Todas las direcciones</option>' + Object.entries(REGIONS).map(([key, label]) => `<option value="${key}">${label}</option>`).join("");
    $("trackingSubtitle").textContent = "Vista consolidada de los avances de las cuatro Direcciones Regionales.";
  } else {
    $("regionFilter").innerHTML = `<option value="${profile.region}">${REGIONS[profile.region]}</option>`;
    $("regionFilter").disabled = true;
    $("trackingSubtitle").textContent = `Tareas asignadas a la Dirección Regional de ${REGIONS[profile.region]}.`;
  }
  await loadAll();
}

function navigate(page) {
  document.querySelectorAll(".page").forEach(element => element.classList.remove("active"));
  $("page-" + page).classList.add("active");
  document.querySelectorAll(".nav").forEach(button => button.classList.toggle("active", button.dataset.page === page));
  $("crumb").textContent = ({ home: "Inicio", plans: "PPVG", tracking: "Seguimiento de PPVG", profile: "Datos del perfil" })[page];
  $("sidebar").classList.remove("open");
}
document.querySelectorAll(".nav").forEach(button => button.addEventListener("click", () => navigate(button.dataset.page)));
document.querySelectorAll("[data-go]").forEach(button => button.addEventListener("click", () => navigate(button.dataset.go)));
$("menu").onclick = () => $("sidebar").classList.toggle("open");
$("logout").onclick = () => signOut(auth);
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
    $("planModal").classList.add("hide"); await loadAll(); showToast(id ? "Tarea actualizada" : "Tarea creada y asignada");
  } catch (error) {
    console.error(error); $("planMsg").textContent = error.message || "No se pudo guardar. Revise los permisos de Firestore.";
  } finally { button.disabled = false; button.textContent = "Guardar tarea"; }
});

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
  moduleSelect.innerHTML = '<option value="all">Todos los módulos</option>' + modules.map(m => `<option value="${escapeHTML(m)}">${escapeHTML(m)}</option>`).join("");
  if (modules.includes(currentModule)) moduleSelect.value = currentModule;
  renderTracking();
}

$("regionFilter").addEventListener("change", renderTracking);
$("periodFilter").addEventListener("change", renderTracking);
$("moduleFilter").addEventListener("change", renderTracking);
$("trackingSearch")?.addEventListener("input", renderTracking);
function percentage(value, goal) { return goal > 0 ? Math.round(value / goal * 100) : 0; }
function renderTracking() {
  const selectedRegion = $("regionFilter").value;
  const selectedModule = $("moduleFilter").value;
  let rows = tracking.filter(item => profile.role !== "admin" ? (item.region === profile.region && (!item.targetedToSpecificPeople || (item.targetUserIds || []).includes(user.uid))) : (selectedRegion === "all" || item.region === selectedRegion));
  if (selectedModule !== "all") rows = rows.filter(item => (item.module || "PPVG") === selectedModule);
  const selectedPeriod = $("periodFilter").value;
  if (selectedPeriod === "one") rows = rows.filter(item => Number(item.periodOne || 0) > 0);
  if (selectedPeriod === "two") rows = rows.filter(item => Number(item.periodTwo || 0) > 0);
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
  $("progressId").value = id; $("progressActivity").textContent = `${item.activity} · ${REGIONS[item.region]}`;
  $("progressGoal").value = item.goal; $("progressOne").value = item.periodOne || 0; $("progressTwo").value = item.periodTwo || 0;
  $("progressNotes").value = item.notes || ""; $("progressMsg").textContent = "";
  const readOnly = profile.role === "admin";
  ["progressOne", "progressTwo", "progressNotes"].forEach(field => $(field).disabled = readOnly);
  $("progressForm").querySelector("button.primary").classList.toggle("hide", readOnly);
  updatePreview(); $("progressModal").classList.remove("hide");
}
function updatePreview() {
  const goal = Number($("progressGoal").value), one = Number($("progressOne").value), two = Number($("progressTwo").value);
  $("calcPreview").textContent = `I período: ${percentage(one, goal)}% · II período: ${percentage(two, goal)}% · Anual: ${percentage(one + two, goal)}%`;
}
["progressOne", "progressTwo"].forEach(id => $(id).addEventListener("input", updatePreview));
$("progressForm").addEventListener("submit", async event => {
  event.preventDefault();
  const id = $("progressId").value, item = tracking.find(row => row.id === id); if (!item || profile.role !== "regional") return;
  const one = Number($("progressOne").value), two = Number($("progressTwo").value);
  if (one < 0 || two < 0) { $("progressMsg").textContent = "Los valores no pueden ser negativos."; return; }
  if (one + two > Number(item.goal || 0)) { $("progressMsg").textContent = "La suma de los logros no puede superar la meta asignada."; return; }
  const data = { assignmentId: id, planId: item.planId, region: item.region, goal: Number(item.goal || 0), activity: item.activity, objective: item.objective || "", periodOne: one, periodTwo: two, notes: $("progressNotes").value.trim(), updatedAt: serverTimestamp(), updatedBy: user.uid };
  try {
    await setDoc(doc(db, "ppvgTracking", id), data, { merge: true });
    $("progressModal").classList.add("hide"); await loadTracking(); showToast("Seguimiento actualizado correctamente");
  } catch (error) { console.error(error); $("progressMsg").textContent = "No se pudo guardar. Verifique las reglas de Firestore."; }
});
