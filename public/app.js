// ---- State ----
const state = {
  homeStation: null,
  workStation: null,
  walkHome: 5,
  walkWork: 5,
  direction: 'toWork', // 'toWork' or 'toHome'
  stations: [],
  routes: [],
  departures: [],
  refreshTimer: null,
};

// ---- DOM refs ----
const $ = (sel) => document.querySelector(sel);
const setupScreen = $('#setup-screen');
const mainScreen = $('#main-screen');
const homeSelect = $('#home-station-select');
const workSelect = $('#work-station-select');
const walkHomeInput = $('#walk-home-input');
const walkWorkInput = $('#walk-work-input');
const saveSetupBtn = $('#save-setup-btn');
const directionToggle = $('#direction-toggle');
const directionLabel = $('#direction-label');
const fromStationName = $('#from-station-name');
const toStationName = $('#to-station-name');
const departuresList = $('#departures-list');
const tripDetails = $('#trip-details');
const tripTime = $('#trip-time');
const tripTransfers = $('#trip-transfers');
const tripFare = $('#trip-fare');
const doorToDoor = $('#door-to-door');
const d2dTrainMin = $('#d2d-train-min');
const d2dLeaveMin = $('#d2d-leave-min');
const lastUpdated = $('#last-updated');
const settingsBtn = $('#settings-btn');
const settingsOverlay = $('#settings-overlay');
const settingsHomeStation = $('#settings-home-station');
const settingsWorkStation = $('#settings-work-station');
const settingsWalkHome = $('#settings-walk-home');
const settingsWalkWork = $('#settings-walk-work');
const settingsSaveBtn = $('#settings-save-btn');
const settingsCancelBtn = $('#settings-cancel-btn');

// ---- Init ----
async function init() {
  loadSettings();

  if (state.homeStation && state.workStation) {
    autoDetectDirection();
    showMainScreen();
  } else {
    showSetupScreen();
  }
}

function loadSettings() {
  state.homeStation = localStorage.getItem('homeStation');
  state.workStation = localStorage.getItem('workStation');
  state.walkHome = parseInt(localStorage.getItem('walkHome') || '5', 10);
  state.walkWork = parseInt(localStorage.getItem('walkWork') || '5', 10);
}

function saveSettings() {
  localStorage.setItem('homeStation', state.homeStation);
  localStorage.setItem('workStation', state.workStation);
  localStorage.setItem('walkHome', state.walkHome);
  localStorage.setItem('walkWork', state.walkWork);
}

function autoDetectDirection() {
  const hour = new Date().getHours();
  state.direction = (hour < 12 || hour >= 22) ? 'toWork' : 'toHome';
}

// ---- Screens ----
async function showSetupScreen() {
  setupScreen.classList.remove('hidden');
  mainScreen.classList.add('hidden');
  await loadStations();
  populateSelects(homeSelect, workSelect);
  saveSetupBtn.disabled = false;
}

async function showMainScreen() {
  setupScreen.classList.add('hidden');
  mainScreen.classList.remove('hidden');
  await Promise.all([loadStations(), loadRoutes()]);
  updateDirectionUI();
  fetchDepartures();
  fetchTripDetails();
  startAutoRefresh();
}

// ---- Stations ----
async function loadStations() {
  if (state.stations.length > 0) return;
  try {
    const res = await fetch('/api/stations');
    const data = await res.json();
    state.stations = data.root.stations.station.map((s) => ({
      abbr: s.abbr,
      name: s.name,
    }));
    state.stations.sort((a, b) => a.name.localeCompare(b.name));
  } catch (err) {
    console.error('Failed to load stations:', err);
  }
}

// ---- Routes ----
async function loadRoutes() {
  if (state.routes.length > 0) return;
  try {
    const res = await fetch('/api/routes');
    state.routes = await res.json();
  } catch (err) {
    console.error('Failed to load routes:', err);
  }
}

// Check if a train with the given final destination abbreviation will pass
// through our target destination, departing from origin.
function trainReachesDest(origin, dest, trainFinalDest) {
  for (const route of state.routes) {
    const stations = route.stations;
    const origIdx = stations.indexOf(origin);
    const trainEndIdx = stations.indexOf(trainFinalDest);
    const destIdx = stations.indexOf(dest);
    // The train's route must contain origin, and the train must depart
    // in the direction of our destination (trainEndIdx > origIdx),
    // and our destination must be between origin and the train's final stop.
    if (origIdx === -1 || trainEndIdx === -1 || destIdx === -1) continue;
    if (trainEndIdx > origIdx && destIdx > origIdx && destIdx <= trainEndIdx) {
      return true;
    }
  }
  return false;
}

function populateSelects(...selects) {
  selects.forEach((sel) => {
    sel.innerHTML = '<option value="">Select station…</option>';
    state.stations.forEach((s) => {
      const opt = document.createElement('option');
      opt.value = s.abbr;
      opt.textContent = s.name;
      sel.appendChild(opt);
    });
  });
}

function stationName(abbr) {
  const s = state.stations.find((st) => st.abbr === abbr);
  return s ? s.name : abbr;
}

// ---- Direction ----
function getOrigin() {
  return state.direction === 'toWork' ? state.homeStation : state.workStation;
}

function getDestination() {
  return state.direction === 'toWork' ? state.workStation : state.homeStation;
}

function getWalkMinutes() {
  return state.direction === 'toWork' ? state.walkHome : state.walkWork;
}

function updateDirectionUI() {
  const homeName = stationName(state.homeStation);
  const workName = stationName(state.workStation);
  if (state.direction === 'toWork') {
    directionLabel.textContent = `${homeName} → ${workName}`;
  } else {
    directionLabel.textContent = `${workName} → ${homeName}`;
  }
  fromStationName.textContent = stationName(getOrigin());
  toStationName.textContent = stationName(getDestination());
}

function toggleDirection() {
  state.direction = state.direction === 'toWork' ? 'toHome' : 'toWork';
  updateDirectionUI();
  fetchDepartures();
  fetchTripDetails();
}

// ---- Departures ----
async function fetchDepartures() {
  const origin = getOrigin();
  const dest = getDestination();
  departuresList.innerHTML = '<div class="loading">Loading departures…</div>';
  state.transferInfo = null;

  try {
    const res = await fetch(`/api/departures?station=${origin}`);
    const data = await res.json();
    const stationData = data.root.station[0];
    const allEtds = stationData.etd || [];

    // Only show trains whose route passes through our destination
    let relevant = filterDepartures(allEtds, origin, dest);

    // If no direct trains, use trip planner to find first-leg trains
    if (relevant.length === 0) {
      const firstLeg = await getFirstLeg(origin, dest);
      if (firstLeg) {
        state.transferInfo = firstLeg;
        relevant = filterDepartures(allEtds, origin, firstLeg.dest);
      }
    } else {
      state.transferInfo = null;
    }

    // Sort by minutes, take first entries
    relevant.sort((a, b) => a.minutes - b.minutes);
    state.departures = relevant.slice(0, 8);

    renderDepartures();
    updateDoorToDoor();
    updateTimestamp();
  } catch (err) {
    console.error('Failed to fetch departures:', err);
    departuresList.innerHTML = '<div class="error-msg">Failed to load departures. Pull to retry.</div>';
  }
}

function filterDepartures(allEtds, origin, dest) {
  const relevant = [];
  allEtds.forEach((etd) => {
    if (!trainReachesDest(origin, dest, etd.abbreviation)) return;
    etd.estimate.forEach((est) => {
      relevant.push({
        destination: etd.destination,
        destinationAbbr: etd.abbreviation,
        minutes: est.minutes === 'Leaving' ? 0 : parseInt(est.minutes, 10),
        minutesDisplay: est.minutes,
        platform: est.platform,
        color: est.hexcolor || est.color,
        colorName: (est.color || '').toLowerCase(),
        direction: est.direction,
        length: est.length,
      });
    });
  });
  return relevant;
}

async function getFirstLeg(origin, dest) {
  try {
    const res = await fetch(`/api/trip?orig=${origin}&dest=${dest}`);
    const data = await res.json();
    const trips = data.root.schedule.request.trip;
    const trip = Array.isArray(trips) ? trips[0] : trips;
    const legs = Array.isArray(trip.leg) ? trip.leg : [trip.leg];
    if (legs.length > 1) {
      return {
        dest: legs[0]['@destination'],
        destName: stationName(legs[0]['@destination']),
        transferAt: stationName(legs[0]['@destination']),
      };
    }
  } catch (err) {
    console.error('Failed to get first leg:', err);
  }
  return null;
}

function renderDepartures() {
  if (state.departures.length === 0) {
    departuresList.innerHTML = '<div class="loading">No departures found</div>';
    return;
  }

  const transferBanner = state.transferInfo
    ? `<div class="transfer-banner">Transfer at ${state.transferInfo.transferAt}</div>`
    : '';

  departuresList.innerHTML = transferBanner + state.departures
    .map((d, i) => {
      const colorClass = getColorClass(d.colorName);
      const isLeaving = d.minutes === 0;
      const departTime = new Date(Date.now() + d.minutes * 60000);
      const timeStr = departTime.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      return `
        <div class="departure-card border-${colorClass}" onclick="toggleTripDetail(${i})">
          <div class="line-color line-${colorClass}"></div>
          <div class="info">
            <div class="destination">${d.destination}</div>
            <div class="platform">Platform ${d.platform} · ${d.length} car</div>
          </div>
          <div class="time-info">
            <div class="minutes${isLeaving ? ' leaving' : ''}">${isLeaving ? 'Leaving' : d.minutes}</div>
            ${!isLeaving ? '<div class="minutes-label">min</div>' : ''}
            <div class="depart-time">${timeStr}</div>
          </div>
          <div class="expand-icon">›</div>
        </div>
      `;
    })
    .join('');
}

function getColorClass(colorName) {
  const map = {
    yellow: 'yellow',
    red: 'red',
    orange: 'orange',
    green: 'green',
    blue: 'blue',
    beige: 'beige',
    purple: 'purple',
    white: 'default',
  };
  return map[colorName] || 'default';
}

// ---- Trip Details ----
async function fetchTripDetails() {
  const orig = getOrigin();
  const dest = getDestination();
  tripDetails.classList.add('hidden');
  state.trips = [];

  try {
    const res = await fetch(`/api/trip?orig=${orig}&dest=${dest}`);
    const data = await res.json();
    const schedule = data.root.schedule;
    if (!schedule || !schedule.request || !schedule.request.trip) return;

    const trips = schedule.request.trip;
    state.trips = Array.isArray(trips) ? trips : [trips];
    const trip = state.trips[0];

    const tripTimeStr = trip['@tripTime'] ? `${trip['@tripTime']} min` : '—';
    const legArr = Array.isArray(trip.leg) ? trip.leg : [trip.leg];
    const transfers = Math.max(0, legArr.length - 1);
    const fare = trip['@fare'] ? `$${trip['@fare']}` : '—';

    tripTime.textContent = tripTimeStr;
    tripTransfers.textContent = transfers === 0 ? 'Direct' : `${transfers}`;
    tripFare.textContent = fare;
    tripDetails.classList.remove('hidden');
  } catch (err) {
    console.error('Failed to fetch trip details:', err);
  }
}

function findMatchingTrip(departureMin) {
  // Find the trip whose first leg departs closest to this departure's estimated time
  const departTime = Date.now() + departureMin * 60000;
  let best = null;
  let bestDiff = Infinity;
  for (const trip of state.trips) {
    const legArr = Array.isArray(trip.leg) ? trip.leg : [trip.leg];
    const origTimeStr = trip['@origTimeMin'];
    const origDateStr = trip['@origTimeDate'];
    const tripDate = new Date(`${origDateStr} ${origTimeStr}`);
    const diff = Math.abs(tripDate.getTime() - departTime);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = trip;
    }
  }
  return best;
}

function renderTripDetail(trip) {
  if (!trip) return '';
  const legArr = Array.isArray(trip.leg) ? trip.leg : [trip.leg];
  const fare = trip['@fare'] ? `$${trip['@fare']}` : '';
  const totalTime = trip['@tripTime'] ? `${trip['@tripTime']} min total` : '';

  const legsHtml = legArr.map((leg, i) => {
    const origName = stationName(leg['@origin']);
    const destName = stationName(leg['@destination']);
    const trainHead = leg['@trainHeadStation'] || '';
    const origTime = leg['@origTimeMin'] || '';
    const destTime = leg['@destTimeMin'] || '';
    const platform = leg['@originPlatform'] || '';
    const isTransfer = i > 0;

    return `
      ${isTransfer ? '<div class="leg-transfer">Transfer</div>' : ''}
      <div class="leg">
        <div class="leg-timeline">
          <div class="leg-dot"></div>
          <div class="leg-line"></div>
          <div class="leg-dot"></div>
        </div>
        <div class="leg-details">
          <div class="leg-stop">
            <span class="leg-time">${origTime}</span>
            <span class="leg-station">${origName}</span>
            <span class="leg-platform">${platform}</span>
          </div>
          <div class="leg-train">Train to ${trainHead}</div>
          <div class="leg-stop">
            <span class="leg-time">${destTime}</span>
            <span class="leg-station">${destName}</span>
          </div>
        </div>
      </div>
    `;
  }).join('');

  const summaryParts = [totalTime, fare].filter(Boolean).join(' · ');

  return `
    <div class="trip-detail-expanded">
      ${legsHtml}
      ${summaryParts ? `<div class="trip-summary">${summaryParts}</div>` : ''}
    </div>
  `;
}

function toggleTripDetail(index) {
  const cards = departuresList.querySelectorAll('.departure-card');
  const card = cards[index];
  if (!card) return;

  const existing = card.nextElementSibling;
  if (existing && existing.classList.contains('trip-detail-expanded')) {
    existing.remove();
    card.classList.remove('expanded');
    return;
  }

  // Close any other open detail
  departuresList.querySelectorAll('.trip-detail-expanded').forEach((el) => el.remove());
  departuresList.querySelectorAll('.departure-card.expanded').forEach((el) => el.classList.remove('expanded'));

  const dep = state.departures[index];
  if (!dep) return;

  const trip = findMatchingTrip(dep.minutes);
  const html = renderTripDetail(trip);
  if (!html) return;

  card.classList.add('expanded');
  card.insertAdjacentHTML('afterend', html);
}

// ---- Door-to-door ----
function updateDoorToDoor() {
  const walkMin = getWalkMinutes();
  if (!walkMin && walkMin !== 0) {
    doorToDoor.classList.add('hidden');
    return;
  }

  // Find next non-zero departure
  const next = state.departures.find((d) => d.minutes > 0);
  if (!next) {
    d2dTrainMin.textContent = '—';
    d2dLeaveMin.textContent = '—';
    doorToDoor.classList.remove('hidden');
    return;
  }

  const leaveIn = next.minutes - walkMin;

  d2dTrainMin.textContent = `${next.minutes} min`;
  if (leaveIn <= 0) {
    d2dLeaveMin.textContent = 'Now!';
    d2dLeaveMin.classList.add('urgent');
  } else {
    d2dLeaveMin.textContent = `${leaveIn} min`;
    d2dLeaveMin.classList.toggle('urgent', leaveIn <= 5);
  }

  doorToDoor.classList.remove('hidden');
}

// ---- Auto-refresh ----
function startAutoRefresh() {
  stopAutoRefresh();
  state.refreshTimer = setInterval(() => {
    fetchDepartures();
  }, 30000);
}

function stopAutoRefresh() {
  if (state.refreshTimer) {
    clearInterval(state.refreshTimer);
    state.refreshTimer = null;
  }
}

function updateTimestamp() {
  const now = new Date();
  const time = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  lastUpdated.textContent = `Updated ${time}`;
}

// ---- Event listeners ----

// Setup screen: enable save when both stations selected
homeSelect.addEventListener('change', () => {
  saveSetupBtn.disabled = !homeSelect.value || !workSelect.value;
});
workSelect.addEventListener('change', () => {
  saveSetupBtn.disabled = !homeSelect.value || !workSelect.value;
});

// Save setup
saveSetupBtn.addEventListener('click', () => {
  state.homeStation = homeSelect.value;
  state.workStation = workSelect.value;
  state.walkHome = parseInt(walkHomeInput.value, 10) || 0;
  state.walkWork = parseInt(walkWorkInput.value, 10) || 0;
  saveSettings();
  autoDetectDirection();
  showMainScreen();
});

// Direction toggle
directionToggle.addEventListener('click', toggleDirection);

// Settings
settingsBtn.addEventListener('click', async () => {
  await loadStations();
  populateSelects(settingsHomeStation, settingsWorkStation);
  settingsHomeStation.value = state.homeStation;
  settingsWorkStation.value = state.workStation;
  settingsWalkHome.value = state.walkHome;
  settingsWalkWork.value = state.walkWork;
  settingsOverlay.classList.remove('hidden');
});

settingsSaveBtn.addEventListener('click', () => {
  state.homeStation = settingsHomeStation.value;
  state.workStation = settingsWorkStation.value;
  state.walkHome = parseInt(settingsWalkHome.value, 10) || 0;
  state.walkWork = parseInt(settingsWalkWork.value, 10) || 0;
  saveSettings();
  settingsOverlay.classList.add('hidden');
  updateDirectionUI();
  fetchDepartures();
  fetchTripDetails();
});

settingsCancelBtn.addEventListener('click', () => {
  settingsOverlay.classList.add('hidden');
});

// Close settings on overlay backdrop click
settingsOverlay.addEventListener('click', (e) => {
  if (e.target === settingsOverlay) {
    settingsOverlay.classList.add('hidden');
  }
});

// Visibility change: refresh when app comes to foreground
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && mainScreen.classList.contains('hidden') === false) {
    autoDetectDirection();
    updateDirectionUI();
    fetchDepartures();
    fetchTripDetails();
    startAutoRefresh();
  } else {
    stopAutoRefresh();
  }
});

// Register service worker
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch((err) => {
    console.log('SW registration failed:', err);
  });
}

// Boot
init();
