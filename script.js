const API_BASE = "https://api.alquran.cloud/v1";

const reciters = {
    "ar.alafasy": "Mishary Alafasy",
    "ar.abdurrahmaansudais": "Abdurrahman As-Sudais",
    "ar.husary": "Mahmoud Khalil Al-Husary",
    "ar.minshawi": "Mohamed Siddiq Al-Minshawi"
};

const elements = {
    surahTitle: document.querySelector("#surah-title"),
    surahDetails: document.querySelector("#surah-details"),
    chapterCount: document.querySelector("#chapter-count"),
    chapterSearch: document.querySelector("#chapter-search"),
    chapterList: document.querySelector("#chapter-list"),
    readerMessage: document.querySelector("#reader-message"),
    verses: document.querySelector("#verses"),
    progress: document.querySelector("#reading-progress"),
    translationToggle: document.querySelector("#translation-toggle"),
    reciterSelect: document.querySelector("#reciter-select"),
    audio: document.querySelector("#audio-player"),
    audioTitle: document.querySelector("#audio-title"),
    audioReciter: document.querySelector("#audio-reciter"),
    playButton: document.querySelector("#play-button"),
    playIcon: document.querySelector("#play-icon"),
    previousButton: document.querySelector("#previous-verse"),
    nextButton: document.querySelector("#next-verse"),
    seekBar: document.querySelector("#seek-bar"),
    elapsedTime: document.querySelector("#elapsed-time"),
    durationTime: document.querySelector("#duration-time"),
    audioDock: document.querySelector(".audio-dock")
};

let chapters = [];
let currentChapter = null;
let currentVerses = [];
let audioVerses = [];
let currentVerseIndex = -1;
let chapterLoadId = 0;
let audioLoadId = 0;

async function fetchData(url) {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Request failed (${response.status})`);
    }

    const result = await response.json();
    if (result.code !== 200 || !result.data) {
        throw new Error(result.status || "The Quran service returned an unexpected response.");
    }
    return result.data;
}

function showMessage(message, isError = false) {
    elements.readerMessage.textContent = message;
    elements.readerMessage.classList.toggle("is-error", isError);
}

function renderChapters(filter = "") {
    const query = filter.trim().toLocaleLowerCase();
    const filteredChapters = chapters.filter((chapter) => {
        const searchableText = `${chapter.number} ${chapter.name} ${chapter.englishName} ${chapter.englishNameTranslation}`.toLocaleLowerCase();
        return searchableText.includes(query);
    });

    elements.chapterList.replaceChildren();
    elements.chapterCount.textContent = String(chapters.length);

    if (filteredChapters.length === 0) {
        const emptyMessage = document.createElement("p");
        emptyMessage.className = "empty-search";
        emptyMessage.textContent = "No chapters match your search.";
        elements.chapterList.append(emptyMessage);
        return;
    }

    filteredChapters.forEach((chapter) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = `chapter-button${currentChapter?.number === chapter.number ? " is-selected" : ""}`;
        button.setAttribute("aria-current", currentChapter?.number === chapter.number ? "page" : "false");
        button.setAttribute("aria-label", `Read chapter ${chapter.number}: ${chapter.englishName}`);

        const index = document.createElement("span");
        index.className = "chapter-index";
        const indexText = document.createElement("span");
        indexText.textContent = String(chapter.number);
        index.append(indexText);

        const copy = document.createElement("span");
        copy.className = "chapter-copy";
        const name = document.createElement("span");
        name.className = "chapter-name";
        name.textContent = chapter.englishName;
        const meta = document.createElement("span");
        meta.className = "chapter-meta";
        meta.textContent = `${chapter.numberOfAyahs} verses · ${chapter.revelationType}`;
        copy.append(name, meta);

        const arabicName = document.createElement("span");
        arabicName.className = "chapter-arabic";
        arabicName.lang = "ar";
        arabicName.dir = "rtl";
        arabicName.textContent = chapter.name;
        button.append(index, copy, arabicName);
        button.addEventListener("click", () => loadChapter(chapter));
        elements.chapterList.append(button);
    });
}

function renderVerses(verses, translations) {
    elements.verses.replaceChildren();
    currentVerses = verses;

    verses.forEach((verse, index) => {
        const article = document.createElement("article");
        article.className = "verse";
        article.dataset.index = String(index);
        article.setAttribute("aria-label", `Verse ${verse.numberInSurah}`);
        article.tabIndex = 0;

        const topline = document.createElement("div");
        topline.className = "verse-topline";
        const number = document.createElement("span");
        number.className = "verse-number";
        number.textContent = String(verse.numberInSurah);

        const playButton = document.createElement("button");
        playButton.type = "button";
        playButton.className = "verse-play";
        playButton.textContent = "▶ Listen";
        playButton.setAttribute("aria-label", `Listen to verse ${verse.numberInSurah}`);
        playButton.addEventListener("click", (event) => {
            event.stopPropagation();
            playVerse(index);
        });
        topline.append(number, playButton);

        const arabic = document.createElement("p");
        arabic.className = "verse-arabic";
        arabic.lang = "ar";
        arabic.dir = "rtl";
        arabic.textContent = verse.text;

        const translation = document.createElement("p");
        translation.className = "verse-translation";
        translation.textContent = translations[index]?.text || "";
        translation.hidden = !elements.translationToggle.checked || !translation.textContent;

        article.append(topline, arabic, translation);
        article.addEventListener("click", () => playVerse(index));
        article.addEventListener("keydown", (event) => {
            if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                playVerse(index);
            }
        });
        elements.verses.append(article);
    });

    updateActiveVerse();
}

function updateActiveVerse() {
    const verseElements = elements.verses.querySelectorAll(".verse");
    verseElements.forEach((verseElement, index) => {
        const isActive = index === currentVerseIndex;
        verseElement.classList.toggle("is-active", isActive);
        if (isActive) {
            verseElement.setAttribute("aria-current", "true");
        } else {
            verseElement.removeAttribute("aria-current");
        }
    });

    if (currentChapter && currentVerses.length) {
        const activeNumber = currentVerseIndex >= 0
            ? currentVerses[currentVerseIndex].numberInSurah
            : 0;
        elements.progress.textContent = activeNumber
            ? `Verse ${activeNumber} of ${currentVerses.length}`
            : `${currentVerses.length} verses`;
    }
}

async function loadChapter(chapter) {
    const thisLoad = ++chapterLoadId;
    currentChapter = chapter;
    currentVerseIndex = -1;
    currentVerses = [];
    audioVerses = [];
    elements.audio.pause();
    elements.audio.removeAttribute("src");
    elements.audio.load();
    updatePlayerState(false);
    elements.audioTitle.textContent = `${chapter.englishName} · Select a verse`;
    elements.progress.textContent = "Loading chapter…";
    elements.surahTitle.textContent = chapter.englishName;
    elements.surahDetails.textContent = `${chapter.englishNameTranslation} · ${chapter.numberOfAyahs} verses · ${chapter.revelationType}`;
    elements.verses.replaceChildren();
    showMessage("Loading chapter text…");
    renderChapters(elements.chapterSearch.value);

    const chapterNumber = chapter.number;
    const reciter = elements.reciterSelect.value;
    const [arabicResult, translationResult, audioResult] = await Promise.allSettled([
        fetchData(`${API_BASE}/surah/${chapterNumber}/quran-uthmani`),
        fetchData(`${API_BASE}/surah/${chapterNumber}/en.sahih`),
        fetchData(`${API_BASE}/surah/${chapterNumber}/${reciter}`)
    ]);

    if (thisLoad !== chapterLoadId) return;

    if (arabicResult.status === "rejected") {
        showMessage("Could not load Quran text. Please check your internet connection and try again.", true);
        elements.progress.textContent = "Unable to load chapter";
        return;
    }

    const verses = arabicResult.value.ayahs || [];
    const translations = translationResult.status === "fulfilled"
        ? translationResult.value.ayahs || []
        : [];
    audioVerses = audioResult.status === "fulfilled"
        ? audioResult.value.ayahs || []
        : [];
    renderVerses(verses, translations);
    showMessage(
        translationResult.status === "rejected"
            ? "Quran text loaded. Translation could not be reached."
            : audioResult.status === "rejected"
                ? "Quran text loaded. Recitation audio is temporarily unavailable."
                : ""
    );
    if (translationResult.status === "rejected" || audioResult.status === "rejected") {
        elements.readerMessage.classList.add("is-error");
    }
    elements.audioTitle.textContent = `${chapter.englishName} · Choose a verse`;
    elements.progress.textContent = `${verses.length} verses`;
}

function updatePlayerState(isPlaying) {
    elements.playIcon.textContent = isPlaying ? "Ⅱ" : "▶";
    elements.playIcon.classList.toggle("is-paused", !isPlaying);
    elements.playButton.setAttribute("aria-label", isPlaying ? "Pause recitation" : "Play recitation");
    elements.audioDock.classList.toggle("is-playing", isPlaying);
}

function formatTime(seconds) {
    if (!Number.isFinite(seconds)) return "0:00";
    const minutes = Math.floor(seconds / 60);
    const remainder = Math.floor(seconds % 60).toString().padStart(2, "0");
    return `${minutes}:${remainder}`;
}

function updateAudioProgress() {
    const duration = elements.audio.duration;
    const currentTime = elements.audio.currentTime;
    elements.elapsedTime.textContent = formatTime(currentTime);
    elements.durationTime.textContent = formatTime(duration);
    elements.seekBar.value = Number.isFinite(duration) && duration > 0
        ? String(Math.round((currentTime / duration) * 100))
        : "0";
}

async function playVerse(index) {
    if (!currentChapter || index < 0 || index >= currentVerses.length) return;

    currentVerseIndex = index;
    const verse = currentVerses[index];
    const audioVerse = audioVerses[index];
    elements.audioTitle.textContent = `${currentChapter.englishName} · Verse ${verse.numberInSurah}`;
    elements.audioReciter.textContent = reciters[elements.reciterSelect.value];
    elements.progress.textContent = `Verse ${verse.numberInSurah} of ${currentVerses.length}`;
    updateActiveVerse();
    elements.verses.querySelector(`[data-index="${index}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });

    if (!audioVerse?.audio) {
        showMessage("Recitation audio is not available for this verse. Try another reciter.", true);
        updatePlayerState(false);
        return;
    }

    showMessage("");
    const audioUrl = audioVerse.audio;
    if (elements.audio.src !== audioUrl) {
        elements.audio.src = audioUrl;
        elements.audio.load();
    }

    try {
        await elements.audio.play();
        updatePlayerState(true);
    } catch (error) {
        updatePlayerState(false);
        showMessage("Audio could not be played. Please try again.", true);
    }
}

function moveVerse(amount) {
    if (!currentVerses.length) return;
    const nextIndex = currentVerseIndex < 0
        ? 0
        : Math.min(Math.max(currentVerseIndex + amount, 0), currentVerses.length - 1);
    playVerse(nextIndex);
}

async function changeReciter() {
    elements.audioReciter.textContent = reciters[elements.reciterSelect.value];
    if (!currentChapter) return;

    const thisLoad = ++audioLoadId;
    const wasPlaying = !elements.audio.paused;
    const selectedIndex = currentVerseIndex;
    elements.audio.pause();
    updatePlayerState(false);
    showMessage("Loading recitation…");

    try {
        const data = await fetchData(`${API_BASE}/surah/${currentChapter.number}/${elements.reciterSelect.value}`);
        if (thisLoad !== audioLoadId) return;
        audioVerses = data.ayahs || [];
        showMessage("");
        if (wasPlaying && selectedIndex >= 0) {
            await playVerse(selectedIndex);
        }
    } catch (error) {
        if (thisLoad !== audioLoadId) return;
        audioVerses = [];
        showMessage("Could not load this reciter. Please choose another or try again.", true);
    }
}

elements.chapterSearch.addEventListener("input", () => renderChapters(elements.chapterSearch.value));
elements.translationToggle.addEventListener("change", () => {
    elements.verses.querySelectorAll(".verse-translation").forEach((translation) => {
        translation.hidden = !elements.translationToggle.checked || !translation.textContent;
    });
});
elements.reciterSelect.addEventListener("change", changeReciter);
elements.playButton.addEventListener("click", () => {
    if (elements.audio.paused) {
        if (currentVerseIndex < 0) moveVerse(0);
        else playVerse(currentVerseIndex);
    } else {
        elements.audio.pause();
        updatePlayerState(false);
    }
});
elements.previousButton.addEventListener("click", () => {
    if (elements.audio.currentTime > 3) {
        elements.audio.currentTime = 0;
    } else {
        moveVerse(-1);
    }
});
elements.nextButton.addEventListener("click", () => moveVerse(1));
elements.seekBar.addEventListener("input", () => {
    if (Number.isFinite(elements.audio.duration)) {
        elements.audio.currentTime = (Number(elements.seekBar.value) / 100) * elements.audio.duration;
    }
});
elements.audio.addEventListener("timeupdate", updateAudioProgress);
elements.audio.addEventListener("loadedmetadata", updateAudioProgress);
elements.audio.addEventListener("play", () => updatePlayerState(true));
elements.audio.addEventListener("pause", () => updatePlayerState(false));
elements.audio.addEventListener("ended", () => {
    if (currentVerseIndex + 1 < currentVerses.length) {
        playVerse(currentVerseIndex + 1);
    } else {
        updatePlayerState(false);
    }
});
document.addEventListener("keydown", (event) => {
    if (event.key === "/" && !["INPUT", "TEXTAREA"].includes(document.activeElement.tagName)) {
        event.preventDefault();
        elements.chapterSearch.focus();
    }
});

async function initialize() {
    try {
        chapters = await fetchData(`${API_BASE}/surah`);
        renderChapters();
        await loadChapter(chapters[0]);
    } catch (error) {
        showMessage("Could not connect to the Quran service. Check your internet connection and refresh the page.", true);
        elements.surahTitle.textContent = "Welcome to Noor";
        elements.surahDetails.textContent = "Connect to the internet to load Quran chapters and recitations.";
        elements.chapterList.replaceChildren();
        const unavailable = document.createElement("p");
        unavailable.className = "empty-search";
        unavailable.textContent = "Chapters could not be loaded.";
        elements.chapterList.append(unavailable);
    }
}

initialize();
