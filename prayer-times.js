const calculationMethods = {
    MWL: { fajr: 18, isha: 17 },
    ISNA: { fajr: 15, isha: 15 },
    Egypt: { fajr: 19.5, isha: 17.5 },
    Makkah: { fajr: 18.5, ishaMinutes: 90 },
    Karachi: { fajr: 18, isha: 18 }
};

const prayerNames = [
    { key: "Fajr", label: "Fajr", arabic: "الفجر" },
    { key: "Dhuhr", label: "Dhuhr", arabic: "الظهر" },
    { key: "Asr", label: "Asr", arabic: "العصر" },
    { key: "Maghrib", label: "Maghrib", arabic: "المغرب" },
    { key: "Isha", label: "Isha", arabic: "العشاء" }
];

const dateLabel = document.querySelector("#date-label");
const prayerList = document.querySelector("#prayer-list");
const prayerMessage = document.querySelector("#prayer-message");
const locationLabel = document.querySelector("#location-label");
const methodSelect = document.querySelector("#method-select");
const asrMethod = document.querySelector("#asr-method");
const locateButton = document.querySelector("#locate-button");
const coordinatesForm = document.querySelector("#coordinates-form");
const latitudeInput = document.querySelector("#latitude-input");
const longitudeInput = document.querySelector("#longitude-input");
const timezoneInput = document.querySelector("#timezone-input");
const nextPrayerName = document.querySelector("#next-prayer-name");
const nextPrayerTime = document.querySelector("#next-prayer-time");
const adhanFileInput = document.querySelector("#adhan-file");
const adhanAudio = document.querySelector("#adhan-audio");
const audioFileName = document.querySelector("#audio-file-name");
const testAudioButton = document.querySelector("#test-audio-button");
const enableAlertsButton = document.querySelector("#enable-alerts-button");
const alertStatus = document.querySelector("#alert-status");

let coordinates = null;
let todayPrayerTimes = null;
let audioObjectUrl = null;
let alertsEnabled = false;
let lastAlertCheck = Date.now();
let alertedPrayers = new Set();
let displayedDateKey = "";

function localDateKey(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function dateAtLocation(date, position) {
    const deviceOffset = -date.getTimezoneOffset() / 60;
    const locationOffset = Number.isFinite(position.timezoneOffset)
        ? position.timezoneOffset
        : deviceOffset;
    return new Date(date.getTime() + (locationOffset - deviceOffset) * 3600000);
}

function julianDate(date) {
    return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(), 12) / 86400000 + 2440587.5;
}

function normalizeDegrees(degrees) {
    return ((degrees % 360) + 360) % 360;
}

function solarPosition(date) {
    const daysSinceJ2000 = julianDate(date) - 2451545;
    const meanAnomaly = (357.529 + 0.98560028 * daysSinceJ2000) * Math.PI / 180;
    const meanLongitude = normalizeDegrees(280.459 + 0.98564736 * daysSinceJ2000);
    const eclipticLongitude = normalizeDegrees(
        meanLongitude + 1.915 * Math.sin(meanAnomaly) + 0.02 * Math.sin(2 * meanAnomaly)
    );
    const obliquity = (23.439 - 0.00000036 * daysSinceJ2000) * Math.PI / 180;
    const longitudeRadians = eclipticLongitude * Math.PI / 180;
    const rightAscension = normalizeDegrees(
        Math.atan2(Math.cos(obliquity) * Math.sin(longitudeRadians), Math.cos(longitudeRadians)) * 180 / Math.PI
    );
    const equationOfTime = (meanLongitude - rightAscension) / 15;
    const declination = Math.asin(Math.sin(obliquity) * Math.sin(longitudeRadians));
    return { equationOfTime, declination };
}

function hourAngle(latitude, declination, altitude) {
    const latitudeRadians = latitude * Math.PI / 180;
    const cosine = (
        Math.sin(altitude * Math.PI / 180) -
        Math.sin(latitudeRadians) * Math.sin(declination)
    ) / (Math.cos(latitudeRadians) * Math.cos(declination));

    if (!Number.isFinite(cosine) || cosine < -1 || cosine > 1) return null;
    return Math.acos(cosine) * 12 / Math.PI;
}

function getPrayerTimes(date, position, methodName, asrFactor) {
    const method = calculationMethods[methodName] || calculationMethods.MWL;
    const { equationOfTime, declination } = solarPosition(date);
    const timezone = Number.isFinite(position.timezoneOffset)
        ? position.timezoneOffset
        : -date.getTimezoneOffset() / 60;
    const solarNoon = 12 + timezone - position.longitude / 15 - equationOfTime;
    const sunriseAngle = hourAngle(position.latitude, declination, -0.833);
    const fajrAngle = hourAngle(position.latitude, declination, -method.fajr);
    const sunsetAngle = hourAngle(position.latitude, declination, -0.833);
    const asrAltitude = Math.atan(
        1 / (asrFactor + Math.tan(Math.abs(position.latitude * Math.PI / 180 - declination)))
    ) * 180 / Math.PI;
    const asrAngle = hourAngle(position.latitude, declination, asrAltitude);

    if (sunriseAngle === null || sunsetAngle === null) return null;

    const sunset = solarNoon + sunsetAngle;
    const isha = method.ishaMinutes
        ? sunset + method.ishaMinutes / 60
        : solarNoon + hourAngle(position.latitude, declination, -method.isha);

    return {
        Fajr: fajrAngle === null ? null : solarNoon - fajrAngle,
        Dhuhr: solarNoon + 1 / 60,
        Asr: asrAngle === null ? null : solarNoon + asrAngle,
        Maghrib: sunset,
        Isha: isha
    };
}

function formatPrayerTime(hours) {
    if (!Number.isFinite(hours)) return "—";
    const totalMinutes = ((Math.round(hours * 60) % 1440) + 1440) % 1440;
    const time = new Date();
    time.setHours(Math.floor(totalMinutes / 60), totalMinutes % 60, 0, 0);
    return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(time);
}

function prayerDate(date, hours, position) {
    if (!Number.isFinite(hours)) return null;
    const timezoneOffset = Number.isFinite(position.timezoneOffset)
        ? position.timezoneOffset
        : -date.getTimezoneOffset() / 60;
    const localDateAtUtc = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
    return new Date(localDateAtUtc + Math.round(hours * 60) * 60000 - timezoneOffset * 3600000);
}

function setPrayerMessage(message, isError = false) {
    prayerMessage.textContent = message;
    prayerMessage.classList.toggle("is-error", isError);
}

function setAlertStatus(message, isError = false) {
    alertStatus.textContent = message;
    alertStatus.classList.toggle("is-error", isError);
}

function updateNextPrayer() {
    if (!coordinates || !todayPrayerTimes) return;

    const now = new Date();
    const locationNow = dateAtLocation(now, coordinates);
    const upcoming = prayerNames
        .map((prayer) => ({
            ...prayer,
            date: prayerDate(locationNow, todayPrayerTimes[prayer.key], coordinates)
        }))
        .filter((prayer) => prayer.date && prayer.date > now)
        .sort((first, second) => first.date - second.date)[0];

    if (upcoming) {
        nextPrayerName.textContent = upcoming.label;
        const remainingMinutes = Math.max(0, Math.ceil((upcoming.date - now) / 60000));
        const hours = Math.floor(remainingMinutes / 60);
        const minutes = remainingMinutes % 60;
        nextPrayerTime.textContent = `${formatPrayerTime(todayPrayerTimes[upcoming.key])} · in ${hours ? `${hours}h ` : ""}${minutes}m`;
        return;
    }

    const tomorrow = new Date(now);
    tomorrow.setTime(locationNow.getTime());
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowTimes = getPrayerTimes(tomorrow, coordinates, methodSelect.value, Number(asrMethod.value));
    nextPrayerName.textContent = "Fajr";
    nextPrayerTime.textContent = tomorrowTimes?.Fajr === null || !tomorrowTimes
        ? "Prayer time is not available for tomorrow's date."
        : `${formatPrayerTime(tomorrowTimes.Fajr)} tomorrow`;
}

function renderPrayerTimes() {
    if (!coordinates) return;
    const now = dateAtLocation(new Date(), coordinates);
    const dateKey = localDateKey(now);
    todayPrayerTimes = getPrayerTimes(now, coordinates, methodSelect.value, Number(asrMethod.value));
    displayedDateKey = dateKey;
    alertedPrayers = new Set();
    dateLabel.textContent = new Intl.DateTimeFormat(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric"
    }).format(now);

    prayerList.replaceChildren();
    if (!todayPrayerTimes) {
        const unavailable = document.createElement("p");
        unavailable.className = "empty-search";
        unavailable.textContent = "Sunrise and sunset could not be calculated for this location and date.";
        prayerList.append(unavailable);
        setPrayerMessage("Prayer times may not be available at very high latitudes during some seasons.", true);
        updateAlertButton();
        return;
    }

    prayerNames.forEach((prayer) => {
        const row = document.createElement("div");
        row.className = "prayer-row";
        const name = document.createElement("div");
        name.className = "prayer-name";
        const english = document.createElement("strong");
        english.textContent = prayer.label;
        const arabic = document.createElement("span");
        arabic.lang = "ar";
        arabic.dir = "rtl";
        arabic.textContent = prayer.arabic;
        name.append(english, arabic);
        const time = document.createElement("time");
        time.className = "prayer-time";
        time.textContent = formatPrayerTime(todayPrayerTimes[prayer.key]);
        row.append(name, time);
        prayerList.append(row);
    });

    setPrayerMessage("");
    updateNextPrayer();
    updateAlertButton();
}

function updateAlertButton() {
    enableAlertsButton.disabled = !coordinates || !todayPrayerTimes || !audioObjectUrl;
    enableAlertsButton.textContent = alertsEnabled ? "Prayer alerts are on" : "Enable prayer alerts";
    enableAlertsButton.classList.toggle("is-enabled", alertsEnabled);
}

function updateLocation(position, label) {
    coordinates = {
        latitude: position.latitude,
        longitude: position.longitude,
        timezoneOffset: Number.isFinite(position.timezoneOffset) ? position.timezoneOffset : null
    };
    alertsEnabled = false;
    locationLabel.textContent = label;
    renderPrayerTimes();
    setAlertStatus("Choose “Enable prayer alerts” when you're ready. This page must stay open.");
}

locateButton.addEventListener("click", () => {
    if (!navigator.geolocation) {
        setPrayerMessage("Location is not supported by this browser. Enter coordinates manually instead.", true);
        return;
    }

    locateButton.disabled = true;
    locateButton.textContent = "Finding location…";
    setPrayerMessage("Waiting for location permission…");
    navigator.geolocation.getCurrentPosition(
        (position) => {
            updateLocation(position.coords, "Device location · calculated privately");
            locateButton.disabled = false;
            locateButton.textContent = "Refresh my location";
        },
        (error) => {
            locateButton.disabled = false;
            locateButton.textContent = "Use my location";
            if (error.code === error.PERMISSION_DENIED) {
                setPrayerMessage("Location permission was denied. Allow it in your browser settings or enter coordinates manually.", true);
            } else if (error.code === error.TIMEOUT) {
                setPrayerMessage("The location request timed out. Try again or enter coordinates manually.", true);
            } else {
                setPrayerMessage("Could not get your location. This feature may need HTTPS or localhost; you can also enter coordinates manually.", true);
            }
        },
        { enableHighAccuracy: false, timeout: 12000, maximumAge: 300000 }
    );
});

coordinatesForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const latitude = Number(latitudeInput.value);
    const longitude = Number(longitudeInput.value);
    const timezoneOffset = Number(timezoneInput.value);
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
        !Number.isFinite(longitude) || longitude < -180 || longitude > 180 ||
        !Number.isFinite(timezoneOffset) || timezoneOffset < -12 || timezoneOffset > 14) {
        setPrayerMessage("Enter valid coordinates and a UTC offset between −12 and +14.", true);
        return;
    }
    updateLocation({ latitude, longitude, timezoneOffset }, "Manually entered · calculated privately");
});

function updateCalculationSettings() {
    if (!coordinates) return;
    alertsEnabled = false;
    renderPrayerTimes();
    setAlertStatus("Calculation settings changed. Enable alerts again to use the updated times.");
}

methodSelect.addEventListener("change", updateCalculationSettings);
asrMethod.addEventListener("change", updateCalculationSettings);

adhanFileInput.addEventListener("change", () => {
    const file = adhanFileInput.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("audio/")) {
        setAlertStatus("Please choose an audio file.", true);
        adhanFileInput.value = "";
        return;
    }
    adhanAudio.pause();
    if (audioObjectUrl) URL.revokeObjectURL(audioObjectUrl);
    audioObjectUrl = URL.createObjectURL(file);
    adhanAudio.src = audioObjectUrl;
    audioFileName.textContent = file.name;
    testAudioButton.disabled = false;
    testAudioButton.textContent = "Test audio";
    alertsEnabled = false;
    updateAlertButton();
    setAlertStatus("Audio selected. Test it, then enable prayer alerts.");
});

testAudioButton.addEventListener("click", async () => {
    if (!audioObjectUrl) return;
    if (!adhanAudio.paused) {
        adhanAudio.pause();
        adhanAudio.currentTime = 0;
        return;
    }
    try {
        adhanAudio.currentTime = 0;
        await adhanAudio.play();
        testAudioButton.textContent = "Stop audio";
        setAlertStatus("Playing your Adhan audio. Select Stop audio when you're ready.");
    } catch (error) {
        setAlertStatus("The audio could not be played. Try a different audio file or check your device volume.", true);
    }
});

adhanAudio.addEventListener("ended", () => {
    testAudioButton.textContent = "Test audio";
    if (alertsEnabled) setAlertStatus("Adhan finished. Prayer alerts are still enabled.");
});
adhanAudio.addEventListener("pause", () => {
    testAudioButton.textContent = "Test audio";
});

enableAlertsButton.addEventListener("click", async () => {
    if (!coordinates || !todayPrayerTimes || !audioObjectUrl) return;
    let notificationMessage = "";
    if ("Notification" in window) {
        if (Notification.permission === "default") {
            try {
                await Notification.requestPermission();
            } catch (error) {
                notificationMessage = "Browser notifications could not be enabled; in-page audio alerts will still work.";
            }
        }
        if (Notification.permission === "denied") {
            notificationMessage = "Notifications are blocked; in-page audio alerts will still work.";
        }
    } else {
        notificationMessage = "This browser does not support notifications; in-page audio alerts will still work.";
    }

    alertsEnabled = true;
    lastAlertCheck = Date.now();
    updateAlertButton();
    setAlertStatus(notificationMessage || "Prayer alerts are on. Keep this page open and your device volume up.");
});

function checkPrayerAlerts() {
    const now = Date.now();
    const locationNow = coordinates ? dateAtLocation(new Date(), coordinates) : new Date();
    if (coordinates && displayedDateKey !== localDateKey(locationNow)) {
        renderPrayerTimes();
        lastAlertCheck = now;
        return;
    }

    if (!alertsEnabled || !todayPrayerTimes) {
        lastAlertCheck = now;
        updateNextPrayer();
        return;
    }

    prayerNames.forEach((prayer) => {
        const prayerTime = prayerDate(locationNow, todayPrayerTimes[prayer.key], coordinates);
        const alertKey = `${localDateKey(locationNow)}-${prayer.key}`;
        if (prayerTime && prayerTime.getTime() > lastAlertCheck && prayerTime.getTime() <= now && !alertedPrayers.has(alertKey)) {
            alertedPrayers.add(alertKey);
            announcePrayer(prayer);
        }
    });
    lastAlertCheck = now;
    updateNextPrayer();
}

function announcePrayer(prayer) {
    setAlertStatus(`It's time for ${prayer.label}. Playing your Adhan audio.`);
    adhanAudio.currentTime = 0;
    testAudioButton.textContent = "Stop audio";
    adhanAudio.play().catch((error) => {
        setAlertStatus(`It's time for ${prayer.label}, but audio playback was blocked. Open the page and press Test audio first.`, true);
    });

    if ("Notification" in window && Notification.permission === "granted") {
        const notification = new Notification(`It's time for ${prayer.label}`, {
            body: `Prayer time: ${formatPrayerTime(todayPrayerTimes[prayer.key])}`
        });
        notification.addEventListener("click", () => window.focus(), { once: true });
    }
}

window.addEventListener("beforeunload", () => {
    if (audioObjectUrl) URL.revokeObjectURL(audioObjectUrl);
});

dateLabel.textContent = new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric"
}).format(new Date());
timezoneInput.value = String(-new Date().getTimezoneOffset() / 60);
setInterval(checkPrayerAlerts, 10000);
