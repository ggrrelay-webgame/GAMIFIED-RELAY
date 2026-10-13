/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { AppState, ActiveSession, AttemptLog, QuizItem, TeamGroup, SurveyResponse } from './types.js';
import { PHASES, GROUP_COLORS, BANK } from './data/phases.js';
import { sounds } from './utils/audio.js';
import { recalculateCompletedToday } from './utils/exportUtils.js';
import {
  MISSIONS_CURRICULUM,
  RELAY_ROLES_INFO,
  getRotatedRoles,
  getDepEdRating
} from './data/ggrCurriculum.js';
import { Mascot } from './components/Mascot.js';
import { TeacherPanel } from './components/TeacherPanel.js';
import { CsvSyncModal } from './components/CsvSyncModal.js';

const STATE_KEY = 'ggr_state_v4';
const LOG_KEY = 'ggr_log_v4';
const SURVEY_KEY = 'ggr_survey_v4';

export const THEMES = [
  { id: 'track', name: '🏟️ Stadium Grass', preview: 'linear-gradient(135deg, #FFF7EA, #1F9D68)' },
  { id: 'ocean', name: '🌊 Ocean Splash', preview: 'linear-gradient(135deg, #E0F2FE, #0284C7)' },
  { id: 'sunset', name: '🌅 Sunset Dash', preview: 'linear-gradient(135deg, #FFEDD5, #EA580C)' },
  { id: 'bubblegum', name: '🍬 Bubblegum Pop', preview: 'linear-gradient(135deg, #FAE8FF, #C026D3)' },
  { id: 'emerald', name: '🌿 Forest Mint', preview: 'linear-gradient(135deg, #DCFCE7, #059669)' },
  { id: 'lemon', name: '🍋 Sunny Gold', preview: 'linear-gradient(135deg, #FEF08A, #65A30D)' },
  { id: 'cosmic', name: '🚀 Cosmic Arcade', preview: 'linear-gradient(135deg, #1E1B4B, #818CF8)' }
];

function defaultState(): AppState {
  return {
    pin: '1234',
    currentPhaseIndex: 0,
    completedToday: {
      pretest: [],
      session1: [],
      session2: [],
      session3: [],
      session4: [],
      posttest: []
    },
    groups: [0, 1, 2, 3].map((i) => ({
      name: `Team ${i + 1}`,
      members: [1, 2, 3, 4, 5].map((n) => `Runner ${n}`)
    })),
    surveyResponses: []
  };
}

function loadState(): AppState {
  try {
    const raw = localStorage.getItem(STATE_KEY) || localStorage.getItem('ggr_state_v3');
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw);
    const loaded = Object.assign(defaultState(), parsed);
    const defaultGroups = defaultState().groups;
    const finalGroups: TeamGroup[] = [];
    for (let i = 0; i < 4; i++) {
      const existing =
        Array.isArray(loaded.groups) && loaded.groups[i] ? loaded.groups[i] : defaultGroups[i];
      const existingName = existing && existing.name ? existing.name : `Team ${i + 1}`;
      let members: string[] =
        existing && Array.isArray(existing.members) ? [...existing.members] : [];
      if (members.length < 5) {
        for (let m = members.length; m < 5; m++) {
          members.push(`Runner ${m + 1}`);
        }
      } else if (members.length > 5) {
        members = members.slice(0, 5);
      }
      finalGroups.push({
        name: existingName,
        members
      });
    }
    loaded.groups = finalGroups;
    return loaded;
  } catch {
    return defaultState();
  }
}

function loadLog(): AttemptLog[] {
  try {
    const raw = localStorage.getItem(LOG_KEY) || localStorage.getItem('ggr_log_v3');
    return JSON.parse(raw || '[]') || [];
  } catch {
    return [];
  }
}

function loadSurveys(): SurveyResponse[] {
  try {
    const raw = localStorage.getItem(SURVEY_KEY);
    return JSON.parse(raw || '[]') || [];
  } catch {
    return [];
  }
}

interface ConfettiItem {
  id: number;
  left: number;
  background: string;
  duration: number;
  delay: number;
}

export default function App() {
  const [appState, setAppState] = useState<AppState>(() => loadState());
  const [logData, setLogData] = useState<AttemptLog[]>(() => loadLog());
  const [surveys, setSurveys] = useState<SurveyResponse[]>(() => loadSurveys());
  const [serverVersion, setServerVersion] = useState<number>(0);
  const [lastClearedAt, setLastClearedAt] = useState<string | null>(null);
  const [isOnline, setIsOnline] = useState<boolean>(true);

  // Team Log In state & persistent login
  const [loggedTeamIndex, setLoggedTeamIndex] = useState<number | null>(() => {
    try {
      const saved = localStorage.getItem('ggr_logged_team_index');
      if (saved !== null && saved !== '') {
        const val = parseInt(saved, 10);
        if (!isNaN(val) && val >= 0 && val < 4) return val;
      }
    } catch {}
    return null;
  });

  // Screen routing - before going to the road map, learners must log in first!
  const [screen, setScreen] = useState<string>(() => {
    try {
      const saved = localStorage.getItem('ggr_logged_team_index');
      if (saved !== null && saved !== '') {
        const val = parseInt(saved, 10);
        if (!isNaN(val) && val >= 0 && val < 4) return 'map';
      }
    } catch {}
    return 'team_login';
  });
  const [selectedPhaseIndex, setSelectedPhaseIndex] = useState<number>(0);
  const [session, setSession] = useState<ActiveSession | null>(null);

  // Standing overview modal / drawer
  const [showStandingsModal, setShowStandingsModal] = useState<boolean>(false);

  // Team Log In form inputs
  const [loginTeamIndex, setLoginTeamIndex] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('ggr_logged_team_index');
      if (saved !== null && saved !== '') {
        const val = parseInt(saved, 10);
        if (!isNaN(val) && val >= 0 && val < 4) return val;
      }
    } catch {}
    return 0;
  });
  const [loginTeamName, setLoginTeamName] = useState<string>(() => {
    try {
      const saved = localStorage.getItem('ggr_logged_team_index');
      const idx = saved !== null && !isNaN(parseInt(saved, 10)) ? parseInt(saved, 10) : 0;
      return loadState().groups[idx]?.name || `Team ${idx + 1}`;
    } catch {
      return loadState().groups[0]?.name || 'Team 1';
    }
  });
  const [loginRunners, setLoginRunners] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('ggr_logged_team_index');
      const idx = saved !== null && !isNaN(parseInt(saved, 10)) ? parseInt(saved, 10) : 0;
      return [...(loadState().groups[idx]?.members || defaultState().groups[idx].members)];
    } catch {
      return [...loadState().groups[0]?.members];
    }
  });
  const [loginError, setLoginError] = useState<string | null>(null);

  // Instructional Sub-Steps within Missions (I DO, WE DO)
  const [iDoSubStep, setIDoSubStep] = useState<number>(0);
  const [weDoSubStep, setWeDoSubStep] = useState<number>(0);
  const [showHintBox, setShowHintBox] = useState<boolean>(false);
  const [interactiveSelectedAnswer, setInteractiveSelectedAnswer] = useState<number | null>(null);
  const [interactiveFeedback, setInteractiveFeedback] = useState<{ isCorrect: boolean; message: string } | null>(null);

  // Bonus Laps state
  const [bonusWeDoIndex, setBonusWeDoIndex] = useState<number>(0);
  const [bonusLap2WeDoIndex, setBonusLap2WeDoIndex] = useState<number>(0);

  // Item feedback & option selection
  const [selectedOptionIndex, setSelectedOptionIndex] = useState<number | null>(null);
  const [feedbackOverlayShow, setFeedbackOverlayShow] = useState<boolean>(false);
  const [feedbackCardType, setFeedbackCardType] = useState<'good' | 'bad' | 'neutral'>('neutral');
  const [feedbackTitle, setFeedbackTitle] = useState<string>('Correct!');
  const [feedbackSub, setFeedbackSub] = useState<string>('Nice grammar instincts.');

  // Confetti & Celebration
  const [confetti, setConfetti] = useState<ConfettiItem[]>([]);
  const [endBadge, setEndBadge] = useState<string>('🏅');
  const [endTitle, setEndTitle] = useState<string>('Mission Complete!');
  const [endMsg, setEndMsg] = useState<string>('Great teamwork out there.');

  // Survey Form State
  const [surveyQ1, setSurveyQ1] = useState<number>(5);
  const [surveyQ2, setSurveyQ2] = useState<number>(5);
  const [surveyQ3, setSurveyQ3] = useState<number>(5);
  const [surveyComment, setSurveyComment] = useState<string>('');

  // Admin and PIN modals
  const [isPinModalOpen, setIsPinModalOpen] = useState<boolean>(false);
  const [isAdminModalOpen, setIsAdminModalOpen] = useState<boolean>(false);
  const [isCsvSyncModalOpen, setIsCsvSyncModalOpen] = useState<boolean>(false);
  const [lockedModalInfo, setLockedModalInfo] = useState<{
    title: string;
    message: string;
    icon: string;
  } | null>(null);
  const [pinInput, setPinInput] = useState<string>('');
  const [pinError, setPinError] = useState<boolean>(false);
  const [adminNotification, setAdminNotification] = useState<string | null>(null);
  const pinInputRef = useRef<HTMLInputElement>(null);

  // Background Theme State
  const [currentTheme, setCurrentTheme] = useState<string>(() => {
    return localStorage.getItem('ggr_theme') || 'track';
  });
  const [showThemePicker, setShowThemePicker] = useState<boolean>(false);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', currentTheme);
    localStorage.setItem('ggr_theme', currentTheme);
  }, [currentTheme]);

  // Sync persistence locally
  useEffect(() => {
    localStorage.setItem(STATE_KEY, JSON.stringify(appState));
  }, [appState]);

  useEffect(() => {
    localStorage.setItem(LOG_KEY, JSON.stringify(logData));
  }, [logData]);

  useEffect(() => {
    localStorage.setItem(SURVEY_KEY, JSON.stringify(surveys));
  }, [surveys]);

  // Guard: before going to the road map, learners must log in first!
  useEffect(() => {
    if (screen === 'map' && loggedTeamIndex === null) {
      setScreen('team_login');
    }
  }, [screen, loggedTeamIndex]);

  // =========================================================================
  // MULTI-PHONE CENTRALIZED SYNCHRONIZATION ENGINE
  // =========================================================================
  const serverVersionRef = useRef<number>(0);
  const lastClearedAtRef = useRef<string | null>(null);
  const logCountRef = useRef<number>(logData.length);

  useEffect(() => {
    serverVersionRef.current = serverVersion;
  }, [serverVersion]);

  useEffect(() => {
    lastClearedAtRef.current = lastClearedAt;
  }, [lastClearedAt]);

  useEffect(() => {
    logCountRef.current = logData.length;
  }, [logData.length]);

  const fetchServerSync = async () => {
    try {
      const res = await fetch('/api/sync', { headers: { 'Cache-Control': 'no-cache' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setIsOnline(true);
      const newVer = data.version || 1;
      setServerVersion(newVer);
      serverVersionRef.current = newVer;
      setLastClearedAt(data.lastClearedAt || null);
      lastClearedAtRef.current = data.lastClearedAt || null;

      if (Array.isArray(data.logData)) {
        setLogData(data.logData);
        logCountRef.current = data.logData.length;
        localStorage.setItem(LOG_KEY, JSON.stringify(data.logData));
      }

      if (data.appState) {
        setAppState((prev) => {
          const merged = { ...prev, ...data.appState };
          localStorage.setItem(STATE_KEY, JSON.stringify(merged));
          return merged;
        });
      }
    } catch {
      setIsOnline(false);
    }
  };

  // Fast heartbeat loop every 1.5 seconds for instant multi-phone synchronicity
  useEffect(() => {
    fetchServerSync();
    const interval = setInterval(async () => {
      try {
        const res = await fetch('/api/sync/version', { headers: { 'Cache-Control': 'no-cache' } });
        if (res.ok) {
          const verData = await res.json();
          setIsOnline(true);
          if (
            verData.version !== serverVersionRef.current ||
            verData.lastClearedAt !== lastClearedAtRef.current ||
            verData.logCount !== logCountRef.current
          ) {
            await fetchServerSync();
          }
        }
      } catch {
        setIsOnline(false);
      }
    }, 1500);

    return () => clearInterval(interval);
  }, []);

  const activePhase = PHASES[selectedPhaseIndex] || PHASES[0];
  const activeMissionCurriculum = MISSIONS_CURRICULUM[activePhase.key];

  const triggerConfetti = () => {
    const pieces: ConfettiItem[] = [];
    for (let i = 0; i < 36; i++) {
      pieces.push({
        id: Date.now() + i,
        left: Math.random() * 100,
        background: GROUP_COLORS[Math.floor(Math.random() * GROUP_COLORS.length)],
        duration: 2 + Math.random() * 1.5,
        delay: Math.random() * 0.4
      });
    }
    setConfetti(pieces);
    setTimeout(() => setConfetti([]), 4000);
  };

  const handleSelectLoginTeam = (idx: number) => {
    sounds.playTap();
    setLoginTeamIndex(idx);
    const grp = appState.groups[idx];
    setLoginTeamName(grp.name);
    setLoginRunners([...grp.members]);
    setLoginError(null);
  };

  const handleLoginSubmit = () => {
    if (!loginTeamName.trim()) {
      sounds.playWrong();
      setLoginError('Please enter a team name.');
      return;
    }
    const hasEmpty = loginRunners.some((r) => !r.trim());
    if (hasEmpty) {
      sounds.playWrong();
      setLoginError('Please enter names for all 5 runners in your relay team.');
      return;
    }
    sounds.playCorrect();
    const updatedGroups = appState.groups.map((g, idx) => {
      if (idx !== loginTeamIndex) return g;
      return {
        name: loginTeamName.trim(),
        members: loginRunners.map((r, rIdx) => r.trim() || `Runner ${rIdx + 1}`)
      };
    });
    const updatedState = {
      ...appState,
      groups: updatedGroups
    };
    setAppState(updatedState);
    setLoggedTeamIndex(loginTeamIndex);
    try {
      localStorage.setItem('ggr_logged_team_index', String(loginTeamIndex));
    } catch {}
    setLoginError(null);

    // Sync team login rosters to server
    fetch('/api/state/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appState: updatedState })
    }).catch(() => {});

    // Proceed directly to the Race Road Map!
    setScreen('map');
    window.scrollTo(0, 0);
  };

  const handleNodeTap = (index: number) => {
    if (index !== appState.currentPhaseIndex) {
      sounds.playWrong();
      const ph = PHASES[index];
      if (index < appState.currentPhaseIndex) {
        setLockedModalInfo({
          title: `${ph.label} is Already Completed!`,
          message: `This station was already finished earlier by the class. To re-attempt ${ph.label}, ask your teacher to set it as active in the Teacher Area (⚙️ settings).`,
          icon: '🏁'
        });
      } else {
        setLockedModalInfo({
          title: `🔒 ${ph.label} is Locked!`,
          message: `This mission is not active yet! Please wait for your teacher to open ${ph.label} from the Teacher Area (⚙️ settings).`,
          icon: '⏳'
        });
      }
      return;
    }

    // Ensure learners log in before attempting any station on the roadmap
    if (loggedTeamIndex === null) {
      sounds.playTap();
      setScreen('team_login');
      window.scrollTo(0, 0);
      return;
    }

    sounds.playTap();
    setSelectedPhaseIndex(index);
    const ph = PHASES[index];
    const doneList = appState.completedToday[ph.key] || [];
    if (doneList.includes(loggedTeamIndex)) {
      sounds.playWrong();
      const g = appState.groups[loggedTeamIndex];
      setLockedModalInfo({
        title: `${g.name} Already Finished Today!`,
        message: `Great job earlier! Your team has already completed ${ph.label} today. When this activity is reset by your teacher, it will become accessible again!`,
        icon: '✅'
      });
      return;
    }

    if (index === 0) {
      // PRETEST: Start pretest immediately for the logged-in relay team
      const itemCount = ph.itemCount;
      const itemOrder = Array.from({ length: itemCount }, (_, i) => i);
      setSession({
        phaseIndex: 0,
        groupIndex: loggedTeamIndex,
        itemOrder,
        itemIndex: 0,
        turnPlayerIndex: 0
      });
      setScreen('pretest_welcome');
    } else {
      // Missions / Posttest: Launch directly for the logged-in team
      handleGroupSelect(loggedTeamIndex);
    }
    window.scrollTo(0, 0);
  };

  const handleGroupSelect = (groupIndex: number) => {
    if (selectedPhaseIndex !== appState.currentPhaseIndex) {
      sounds.playWrong();
      const ph = PHASES[selectedPhaseIndex];
      setLockedModalInfo({
        title: `🔒 Station Not Active`,
        message: `${ph.label} is not currently active. Ask your teacher to activate it before racing!`,
        icon: '⏳'
      });
      return;
    }
    sounds.playTap();
    const ph = PHASES[selectedPhaseIndex];
    const doneList = appState.completedToday[ph.key] || [];
    if (doneList.includes(groupIndex)) {
      sounds.playWrong();
      const g = appState.groups[groupIndex];
      setLockedModalInfo({
        title: `${g.name} Already Finished Today!`,
        message: `Great job earlier! Your team has already completed ${ph.label} today. When this activity is deleted or reset by your teacher, it will become accessible again!`,
        icon: '✅'
      });
      return;
    }
    if (ph.key === 'pretest') {
      setLoginTeamIndex(groupIndex);
      const grp = appState.groups[groupIndex];
      setLoginTeamName(grp.name);
      setLoginRunners([...grp.members]);
      setLoginError(null);
      setScreen('team_login');
      window.scrollTo(0, 0);
      return;
    }
    const itemCount = ph.itemCount;
    const itemOrder = Array.from({ length: itemCount }, (_, i) => i);
    setSession({
      phaseIndex: selectedPhaseIndex,
      groupIndex,
      itemOrder,
      itemIndex: 0,
      turnPlayerIndex: 0
    });
    setBonusWeDoIndex(0);
    setBonusLap2WeDoIndex(0);
    if (ph.key === 'posttest') {
      setScreen('posttest_welcome');
    } else {
      setScreen('mission_unlocked');
    }
    window.scrollTo(0, 0);
  };

  const handleStartItemTurn = () => {
    sounds.playTap();
    setSelectedOptionIndex(null);
    setFeedbackOverlayShow(false);
    setScreen('item');
    window.scrollTo(0, 0);
  };

  const handleSelectOption = (choiceIndex: number, currentItem: QuizItem) => {
    if (selectedOptionIndex !== null || !session) return;
    const isCorrect = choiceIndex === currentItem.c;
    const ph = PHASES[session.phaseIndex];
    const g = appState.groups[session.groupIndex];
    const rotated = getRotatedRoles(g.members, session.itemIndex);
    const activeRunnerRole = rotated.find((r) => r.roleInfo.role === 'RUNNER');
    const runnerName = activeRunnerRole ? activeRunnerRole.member : g.members[session.turnPlayerIndex];

    setSelectedOptionIndex(choiceIndex);

    const newLog: AttemptLog = {
      id: `${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      ts: new Date().toISOString(),
      phase: ph.key,
      phaseLabel: ph.label,
      weekLabel: ph.weekLabel,
      team: g.name,
      player: runnerName,
      runnerIndex: session.turnPlayerIndex + 1,
      roleAtTurn: 'RUNNER',
      questionNumber: session.itemIndex + 1,
      prompt: currentItem.p.replace(/\*\*/g, ''),
      chosen: currentItem.o[choiceIndex],
      correctAnswer: currentItem.o[currentItem.c],
      correct: isCorrect
    };

    // Update state locally and sync to central server immediately
    setLogData((prev) => [...prev, newLog]);
    fetch('/api/logs/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ newLog })
    }).catch(() => {});

    if (ph.showFeedback) {
      if (isCorrect) {
        sounds.playCorrect();
        setFeedbackCardType('good');
        setFeedbackTitle('Correct! 🎉');
        setFeedbackSub(currentItem.explanation || 'Nice grammar instincts!');
      } else {
        sounds.playWrong();
        setFeedbackCardType('bad');
        setFeedbackTitle("Not quite - that's okay!");
        setFeedbackSub(
          `The correct answer is "${currentItem.o[currentItem.c]}". ${currentItem.explanation || ''}`
        );
      }
    } else {
      sounds.playTap();
      setFeedbackCardType('neutral');
      setFeedbackTitle('Answer locked in!');
      setFeedbackSub('Baton secured! Moving to the next item.');
    }
    setFeedbackOverlayShow(true);
  };

  const handleNextTurnOrItem = () => {
    sounds.playTap();
    setFeedbackOverlayShow(false);
    setSelectedOptionIndex(null);
    if (!session) return;
    const g = appState.groups[session.groupIndex];
    const ph = PHASES[session.phaseIndex];
    const nextItemIndex = session.itemIndex + 1;
    const nextTurnPlayerIndex = (session.turnPlayerIndex + 1) % g.members.length;

    // Check for Bonus Lap 1 transition after Question 5 (index 4)
    if (ph.key.startsWith('session') && nextItemIndex === 5 && activeMissionCurriculum?.bonusLap1) {
      setSession({
        ...session,
        itemIndex: 5,
        turnPlayerIndex: nextTurnPlayerIndex
      });
      setBonusWeDoIndex(0);
      setInteractiveSelectedAnswer(null);
      setInteractiveFeedback(null);
      setScreen('bonus_lap_1_unlocked');
      window.scrollTo(0, 0);
      return;
    }

    // Check for Bonus Lap 2 transition after Question 10 (index 9)
    if (ph.key.startsWith('session') && nextItemIndex === 10 && activeMissionCurriculum?.bonusLap2) {
      setSession({
        ...session,
        itemIndex: 10,
        turnPlayerIndex: nextTurnPlayerIndex
      });
      setBonusLap2WeDoIndex(0);
      setInteractiveSelectedAnswer(null);
      setInteractiveFeedback(null);
      setScreen('bonus_lap_2_unlocked');
      window.scrollTo(0, 0);
      return;
    }

    if (nextItemIndex >= session.itemOrder.length) {
      const currentDone = appState.completedToday[ph.key] || [];
      if (!currentDone.includes(session.groupIndex)) {
        const updatedCompleted = {
          ...appState.completedToday,
          [ph.key]: [...(appState.completedToday[ph.key] || []), session.groupIndex]
        };
        const updatedState = {
          ...appState,
          completedToday: updatedCompleted
        };
        setAppState(updatedState);

        fetch('/api/state/update', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ appState: updatedState })
        }).catch(() => {});
      }

      sounds.playFanfare();
      triggerConfetti();
      if (ph.key === 'pretest') {
        setScreen('pretest_complete');
      } else if (ph.key === 'posttest') {
        setScreen('posttest_results');
      } else {
        setEndBadge(ph.badgeIcon || '🏅');
        setEndTitle(`${ph.label.toUpperCase()} COMPLETE!`);
        setEndMsg(
          `Amazing work, Relay Runners! You learned the core concepts and earned the ${ph.badgeName || 'Relay Medal'}!`
        );
        setScreen('mission_result');
      }
      window.scrollTo(0, 0);
    } else {
      setSession({
        ...session,
        itemIndex: nextItemIndex,
        turnPlayerIndex: nextTurnPlayerIndex
      });
      setScreen('turn');
      window.scrollTo(0, 0);
    }
  };

  const handleSubmitSurvey = () => {
    sounds.playFanfare();
    triggerConfetti();
    const teamName = session ? appState.groups[session.groupIndex].name : 'Grade 6 Team';
    const newSurvey: SurveyResponse = {
      id: `survey-${Date.now()}`,
      teamName,
      timestamp: new Date().toISOString(),
      q1Rating: surveyQ1,
      q2Rating: surveyQ2,
      q3Rating: surveyQ3,
      comments: surveyComment.trim()
    };
    setSurveys((prev) => [...prev, newSurvey]);
    setScreen('thank_you');
    window.scrollTo(0, 0);
  };

  const handleCheckPin = () => {
    if (pinInput.trim() === appState.pin) {
      sounds.playTap();
      setIsPinModalOpen(false);
      setIsAdminModalOpen(true);
      setPinError(false);
      setPinInput('');
    } else {
      sounds.playWrong();
      setPinError(true);
    }
  };

  const handleSeedSampleData = async () => {
    sounds.playTap();
    const sampleLogs: AttemptLog[] = [];
    const now = new Date();
    ['pretest', 'session1', 'session2', 'session3', 'session4', 'posttest'].forEach((phaseKey, pOffset) => {
      const items = BANK[phaseKey as keyof typeof BANK] || [];
      appState.groups.forEach((group, gIdx) => {
        group.members.forEach((member, mIdx) => {
          const numItems = phaseKey === 'pretest' || phaseKey === 'posttest' ? 12 : 15;
          for (let q = 0; q < numItems; q++) {
            const item = items[q % items.length];
            const baseAcc = phaseKey === 'posttest' ? 0.88 : phaseKey === 'pretest' ? 0.58 : 0.75;
            const isCorrect = Math.random() < baseAcc;
            const chosen = isCorrect ? item.o[item.c] : item.o[(item.c + 1) % item.o.length];
            const logDate = new Date(now.getTime() - (5 - pOffset) * 86400000 + mIdx * 60000 + q * 10000);
            sampleLogs.push({
              id: `seed-${phaseKey}-${gIdx}-${mIdx}-${q}`,
              ts: logDate.toISOString(),
              phase: phaseKey,
              phaseLabel: PHASES.find((p) => p.key === phaseKey)?.label || phaseKey,
              weekLabel: PHASES.find((p) => p.key === phaseKey)?.weekLabel || 'Week',
              team: group.name,
              player: member,
              runnerIndex: mIdx + 1,
              roleAtTurn: RELAY_ROLES_INFO[q % 5].role,
              questionNumber: q + 1,
              prompt: item.p.replace(/\*\*/g, ''),
              chosen,
              correctAnswer: item.o[item.c],
              correct: isCorrect
            });
          }
        });
      });
    });

    const sampleSurveys: SurveyResponse[] = appState.groups.map((g) => ({
      id: `seed-survey-${g.name}`,
      teamName: g.name,
      timestamp: new Date().toISOString(),
      q1Rating: 5,
      q2Rating: 5,
      q3Rating: 5,
      comments: 'We loved the relay roles and Coach Dash guides!'
    }));

    setLogData(sampleLogs);
    setSurveys(sampleSurveys);
    const newCompleted = recalculateCompletedToday(appState, sampleLogs);
    const updatedState = {
      ...appState,
      completedToday: newCompleted,
      surveyResponses: sampleSurveys
    };
    setAppState(updatedState);

    // Sync to server so all phones immediately receive the sample test data
    try {
      await fetch('/api/sync/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ logs: sampleLogs, completedToday: newCompleted, surveys: sampleSurveys })
      });
    } catch {}

    setAdminNotification('Loaded sample data across all phones for Pretest, Missions 1-4, Posttest & Surveys!');
    setTimeout(() => setAdminNotification(null), 4000);
  };

  // Render Theme Drawer
  const renderThemeDrawer = () => {
    if (!showThemePicker) return null;
    return (
      <div className="theme-drawer" style={{ marginTop: '10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '18px' }}>🎨</span>
            <strong style={{ fontSize: '14px', fontFamily: 'Baloo 2' }}>
              Choose Background Color Theme
            </strong>
          </div>
          <button
            type="button"
            style={{ fontSize: '12px', fontWeight: 800, opacity: 0.6, cursor: 'pointer' }}
            onClick={() => setShowThemePicker(false)}
          >
            ✕ Close
          </button>
        </div>
        <div className="theme-options-grid">
          {THEMES.map((th) => (
            <button
              key={th.id}
              type="button"
              className={`theme-card-btn ${currentTheme === th.id ? 'active' : ''}`}
              onClick={() => {
                sounds.playTap();
                setCurrentTheme(th.id);
              }}
            >
              <span className="theme-dot" style={{ background: th.preview }} />
              <span>{th.name}</span>
            </button>
          ))}
        </div>
      </div>
    );
  };

  const renderSessionHeader = () => (
    <div style={{ marginBottom: '14px', borderBottom: '2px solid var(--line)', paddingBottom: '10px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div className="brand-badge" style={{ width: '38px', height: '38px' }}>
            <span style={{ fontSize: '20px' }}>🏃</span>
          </div>
          <div>
            <div className="ggr-catchy-header">
              <span className="ggr-title-text" style={{ fontSize: '16px' }}>
                GAMIFIED GRAMMAR RELAY
              </span>
              <span className="ggr-ggr-badge">(GGR)</span>
            </div>
            <div style={{ fontSize: '10.5px', fontWeight: 700, opacity: 0.75 }}>
              Grade 6 &bull; Basic Sentence Construction &amp; Parts of Speech &bull; Binanuahan ES
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          {loggedTeamIndex !== null && (
            <span
              style={{
                background: GROUP_COLORS[loggedTeamIndex],
                color: '#fff',
                fontSize: '11px',
                fontWeight: 800,
                padding: '4px 10px',
                borderRadius: '16px',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px'
              }}
              title={`Belongs to ${appState.groups[loggedTeamIndex].name}`}
            >
              🏃 {appState.groups[loggedTeamIndex].name}
            </span>
          )}
          <button
            className="icon-btn"
            style={{ width: '34px', height: '34px', fontSize: '16px' }}
            onClick={() => {
              sounds.playTap();
              setShowThemePicker(!showThemePicker);
            }}
            aria-label="Change color theme"
            title="Change background color theme"
          >
            🎨
          </button>
          {loggedTeamIndex !== null && (
            <button
              className="icon-btn"
              style={{ width: '32px', height: '32px' }}
              onClick={() => {
                sounds.playTap();
                setScreen('map');
                window.scrollTo(0, 0);
              }}
              aria-label="Back to track"
              title="Back to Race Map"
            >
              🏁
            </button>
          )}
        </div>
      </div>
      {renderThemeDrawer()}
    </div>
  );

  const renderRelayRolesBar = (groupMembers: string[], currentStepIndex: number) => {
    const rotated = getRotatedRoles(groupMembers, currentStepIndex);
    return (
      <div className="relay-roles-container">
        <div className="relay-roles-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '14px' }}>🏃‍♂️</span>
            <span style={{ fontSize: '12px', fontWeight: 800, fontFamily: 'Baloo 2' }}>
              Meet Relay Roles (Rotates Every Challenge)
            </span>
          </div>
          <div className="team-cheer-badge">READ • THINK • DISCUSS • RUN!</div>
        </div>
        <div className="relay-roles-grid">
          {rotated.map((r, i) => (
            <div
              key={i}
              className={`role-chip ${r.isCurrentTapRunner ? 'active-runner' : ''}`}
              title={`${r.roleInfo.title}: ${r.roleInfo.duty}`}
            >
              <span className="role-icon">{r.roleInfo.icon}</span>
              <div className="role-title">{r.roleInfo.title}</div>
              <div className="role-member">{r.member}</div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  // STANDING OVERVIEW COMPUTATION (Unified across all connected devices)
  const teamStandings = appState.groups.map((group, gi) => {
    const tLogs = logData.filter((l) => {
      if (!l.team) return false;
      const lt = l.team.trim().toLowerCase();
      const gt = group.name.trim().toLowerCase();
      return (
        lt === gt ||
        lt === `team ${gi + 1}` ||
        gt === `team ${gi + 1}` ||
        lt.startsWith(gt) ||
        gt.startsWith(lt)
      );
    });
    const totalAns = tLogs.length;
    const correctAns = tLogs.filter((l) => l.correct).length;
    const accuracy = totalAns > 0 ? Math.round((correctAns / totalAns) * 100) : 0;
    const completedStations = PHASES.filter((ph) =>
      (appState.completedToday[ph.key] || []).includes(gi)
    ).length;

    return {
      index: gi,
      name: group.name,
      color: GROUP_COLORS[gi % GROUP_COLORS.length],
      members: group.members,
      totalAns,
      correctAns,
      accuracy,
      completedStations
    };
  });

  // Sort by correctAns desc, then accuracy desc
  const sortedStandings = [...teamStandings].sort((a, b) => {
    if (b.correctAns !== a.correctAns) return b.correctAns - a.correctAns;
    return b.accuracy - a.accuracy;
  });

  const currentGroup = session ? appState.groups[session.groupIndex] : appState.groups[0];
  const currentItemIndex = session ? session.itemOrder[session.itemIndex] : 0;
  const currentItem = session ? BANK[activePhase.key][currentItemIndex] : BANK.pretest[0];
  const currentItemPromptHtml = currentItem ? currentItem.p.replace(/\*\*(.*?)\*\*/g, '<b>$1</b>') : '';
  const letters = ['A', 'B', 'C', 'D'];

  return (
    <>
      {/* SCREEN: RACE MAP */}
      {screen === 'map' && (
        <div className="screen" id="screen-map">
          <div className="topbar">
            <div className="brand">
              <div className="brand-badge">
                <span style={{ fontSize: '24px' }}>🏃</span>
              </div>
              <div className="brand-name">
                <div className="ggr-catchy-header" style={{ gap: '6px' }}>
                  <span className="ggr-title-text" style={{ fontSize: '18px' }}>
                    Gamified Grammar Relay
                  </span>
                  <span className="ggr-ggr-badge" style={{ fontSize: '10.5px', padding: '1px 6px' }}>
                    GGR
                  </span>
                </div>
                <small>BINANUAHAN ES &middot; COACH DASH</small>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              {loggedTeamIndex !== null && (
                <div
                  className="logged-in-group-badge"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    background: GROUP_COLORS[loggedTeamIndex],
                    color: '#fff',
                    padding: '6px 12px',
                    borderRadius: '20px',
                    boxShadow: '0 2px 6px rgba(0,0,0,0.15)',
                    fontSize: '12px',
                    fontWeight: 800
                  }}
                  title={`Logged in as ${appState.groups[loggedTeamIndex].name} (${appState.groups[loggedTeamIndex].members.join(', ')})`}
                >
                  <span style={{ fontSize: '13px' }}>🏃</span>
                  <span>{appState.groups[loggedTeamIndex].name}</span>
                  <span
                    style={{
                      background: 'rgba(255,255,255,0.25)',
                      padding: '1px 6px',
                      borderRadius: '8px',
                      fontSize: '10px',
                      fontWeight: 700
                    }}
                  >
                    Team {loggedTeamIndex + 1}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      sounds.playTap();
                      const targetTeam = loggedTeamIndex;
                      setLoginTeamIndex(targetTeam);
                      const grp = appState.groups[targetTeam];
                      setLoginTeamName(grp.name);
                      setLoginRunners([...grp.members]);
                      setLoginError(null);
                      setScreen('team_login');
                      window.scrollTo(0, 0);
                    }}
                    style={{
                      background: 'rgba(255,255,255,0.22)',
                      border: 'none',
                      color: '#fff',
                      borderRadius: '50%',
                      width: '18px',
                      height: '18px',
                      fontSize: '10px',
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      marginLeft: '2px',
                      padding: 0
                    }}
                    title="Edit 5 runners roster"
                    aria-label="Edit team roster"
                  >
                    ✏️
                  </button>
                </div>
              )}

              <button
                className="icon-btn"
                style={{ width: '38px', height: '38px', fontSize: '18px' }}
                onClick={() => {
                  sounds.playTap();
                  setShowThemePicker(!showThemePicker);
                }}
                aria-label="Change color theme"
                title="Change background color theme"
              >
                🎨
              </button>
            </div>
          </div>

          {renderThemeDrawer()}

          {/* Sync status pill indicator */}
          <div style={{ textAlign: 'center', marginBottom: '8px' }}>
            <span
              style={{
                fontSize: '11px',
                fontWeight: 800,
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                background: isOnline ? '#D1E7DD' : '#F8D7DA',
                color: isOnline ? '#0F5132' : '#842029',
                padding: '3px 10px',
                borderRadius: '20px'
              }}
            >
              <span
                style={{
                  width: '7px',
                  height: '7px',
                  borderRadius: '50%',
                  background: isOnline ? '#198754' : '#DC3545'
                }}
              />
              {isOnline ? 'Live Cloud Sync: Same across all phones' : 'Offline Mode (Local backup)'}
              {logData.length > 0 && ` • ${logData.length} records`}
            </span>
          </div>

          <div className="mascot-wrap">
            <div className="speech-bubble" id="home-speech">
              {loggedTeamIndex !== null
                ? `“Welcome, ${appState.groups[loggedTeamIndex].name}! Coach Dash is ready for your 5 runners to race!”`
                : `“Welcome, Relay Runners! Let's conquer our missions together!” - Coach Dash`}
            </div>
            <Mascot type="idle" />
          </div>

          <div className="ggr-hero-title">
            <span>GAMIFIED GRAMMAR RELAY </span>
            <span className="ggr-ggr-badge" style={{ fontSize: '18px', verticalAlign: 'middle' }}>
              (GGR)
            </span>
          </div>
          <div className="hero-sub" style={{ textAlign: 'center' }}>
            Basic Sentence Construction &amp; Parts of Speech &bull; 5 Relay Roles per Team
          </div>

          {/* Prominent display of what group they belong to */}
          {loggedTeamIndex !== null && (
            <div
              style={{
                margin: '10px auto 14px auto',
                maxWidth: '460px',
                background: 'var(--cream)',
                border: `2.5px solid ${GROUP_COLORS[loggedTeamIndex]}`,
                borderRadius: '16px',
                padding: '10px 14px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '10px',
                boxShadow: '0 3px 8px rgba(0,0,0,0.06)'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', textAlign: 'left' }}>
                <span style={{ fontSize: '24px' }}>🏃</span>
                <div>
                  <div
                    style={{
                      fontSize: '11px',
                      fontWeight: 800,
                      color: GROUP_COLORS[loggedTeamIndex],
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px'
                    }}
                  >
                    YOU BELONG TO:
                  </div>
                  <div style={{ fontSize: '15px', fontWeight: 900, fontFamily: 'Baloo 2', color: 'var(--ink)' }}>
                    {appState.groups[loggedTeamIndex].name} (Team {loggedTeamIndex + 1})
                  </div>
                  <div style={{ fontSize: '11px', opacity: 0.75, fontWeight: 700, marginTop: '2px' }}>
                    5 Runners: {appState.groups[loggedTeamIndex].members.join(' • ')}
                  </div>
                </div>
              </div>
              <span
                style={{
                  background: GROUP_COLORS[loggedTeamIndex],
                  color: '#fff',
                  fontSize: '11.5px',
                  fontWeight: 800,
                  padding: '4px 10px',
                  borderRadius: '10px',
                  flexShrink: 0
                }}
              >
                Team {loggedTeamIndex + 1}
              </span>
            </div>
          )}

          {/* Full GGR Relay Roadmap */}
          <div id="track-container" className="track-wrap">
            {PHASES.map((ph, i) => {
              const isLeft = i % 2 === 0;
              let status = 'locked';
              if (i < appState.currentPhaseIndex) status = 'done';
              else if (i === appState.currentPhaseIndex) status = 'active';
              return (
                <div key={ph.key} className={`track-node-row ${isLeft ? 'left' : 'right'}`}>
                  <div
                    className={`track-node ${status}`}
                    onClick={() => handleNodeTap(i)}
                    style={{
                      cursor: status === 'active' ? 'pointer' : 'not-allowed',
                      opacity: status === 'active' ? 1 : status === 'done' ? 0.75 : 0.55
                    }}
                  >
                    <div className={`node-dot ${status}`}>
                      {status === 'done' ? '✓' : status === 'locked' ? '🔒' : ph.icon}
                    </div>
                    <div>
                      <div className="node-label">
                        {ph.label} <span style={{ opacity: 0.65, fontSize: '12px' }}>({ph.weekLabel})</span>
                      </div>
                      <div className="node-sub">
                        {ph.sub} &middot; {ph.itemCount} items
                      </div>
                      {status === 'active' && <div className="node-tap">TAP TO START ➔</div>}
                      {status === 'done' && (
                        <div className="node-tap" style={{ color: 'var(--track)' }}>
                          COMPLETED ✅
                        </div>
                      )}
                      {status === 'locked' && (
                        <div className="node-tap" style={{ color: '#888888', fontWeight: 700 }}>
                          LOCKED 🔒
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* MODAL: LIVE STANDINGS OVERVIEW (FULLY RESPONSIVE FOR ALL PHONES) */}
      {showStandingsModal && (
        <div className="modal-backdrop show">
          <div className="modal-box modal-wide" style={{ maxHeight: '90vh' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px', flexWrap: 'wrap', gap: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '26px' }}>🏆</span>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <h2 style={{ fontSize: '20px', margin: 0 }}>Standing Overview &amp; Team Leaderboard</h2>
                    <span style={{ fontSize: '11px', fontWeight: 800, padding: '2px 8px', borderRadius: '12px', background: '#FEF3C7', color: '#92400E' }}>
                      Teacher Presentation Mode
                    </span>
                  </div>
                  <div style={{ fontSize: '11px', opacity: 0.7 }}>
                    Real-time universal ranking across every connected phone &bull; Grade 6 Relay &bull; 🏃 Coach Dash Official Race Tracker
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  style={{ fontSize: '11.5px', padding: '4px 8px', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '4px' }}
                  onClick={() => {
                    sounds.playTap();
                    fetchServerSync();
                  }}
                  title="Refresh standings from server"
                >
                  <span>🔄</span>
                  <span>Sync</span>
                </button>
                <button
                  className="icon-btn"
                  style={{ width: '32px', height: '32px' }}
                  onClick={() => setShowStandingsModal(false)}
                >
                  ✕
                </button>
              </div>
            </div>

            {/* Notification when teacher cleared logs */}
            {lastClearedAt && (
              <div
                style={{
                  background: '#FFF3CD',
                  border: '1.5px solid #FFE69C',
                  color: '#664D03',
                  padding: '8px 12px',
                  borderRadius: '10px',
                  fontSize: '11.5px',
                  fontWeight: 700,
                  marginBottom: '12px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px'
                }}
              >
                <span>🧹</span>
                <span>Teacher reset notice: Logs were recently cleared. Standings reflect the fresh reset across all devices.</span>
              </div>
            )}

            {/* Overview KPI Cards */}
            <div className="kpi-grid" style={{ marginBottom: '14px' }}>
              <div className="kpi-card">
                <div className="kpi-num">{logData.length}</div>
                <div className="kpi-label">Total Answers Logged</div>
              </div>
              <div className="kpi-card">
                <div className="kpi-num">
                  {logData.length > 0
                    ? `${Math.round((logData.filter((l) => l.correct).length / logData.length) * 100)}%`
                    : '0%'}
                </div>
                <div className="kpi-label">Class Accuracy</div>
              </div>
              <div className="kpi-card">
                <div className="kpi-num" style={{ fontSize: '18px', color: sortedStandings[0]?.color }}>
                  {sortedStandings[0]?.correctAns > 0 ? sortedStandings[0].name : 'No Leader Yet'}
                </div>
                <div className="kpi-label">
                  Leader &bull; {sortedStandings[0]?.correctAns || 0} pts
                </div>
              </div>
            </div>

            {/* Standings Cards List (Ultra Responsive for Small Screens & Wide Screens) */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {sortedStandings.map((team, rankIdx) => {
                const rankMedal = rankIdx === 0 ? '🥇 1st' : rankIdx === 1 ? '🥈 2nd' : rankIdx === 2 ? '🥉 3rd' : '🏁 4th';
                return (
                  <div
                    key={team.name}
                    className="team-progress-card"
                    style={{
                      borderLeft: `6px solid ${team.color}`,
                      background: 'var(--card)',
                      boxShadow: '0 3px 6px rgba(0,0,0,0.06)'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px', flexWrap: 'wrap', gap: '6px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span
                          style={{
                            fontSize: '12px',
                            fontWeight: 900,
                            padding: '3px 8px',
                            borderRadius: '8px',
                            background: rankIdx === 0 ? '#FEF08A' : 'var(--cream-2)',
                            color: rankIdx === 0 ? '#854D0E' : 'inherit'
                          }}
                        >
                          {rankMedal}
                        </span>
                        <strong style={{ fontSize: '16px', fontFamily: 'Baloo 2' }}>
                          {team.name}
                        </strong>
                      </div>
                      <div style={{ fontSize: '12px', fontWeight: 800 }}>
                        <span style={{ color: 'var(--track-dark)' }}>{team.correctAns} correct</span> ({team.totalAns} attempts)
                      </div>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '11px', fontWeight: 700, opacity: 0.85, marginBottom: '6px' }}>
                      <div style={{ wordBreak: 'break-word' }}>
                        <span style={{ opacity: 0.65 }}>Runners:</span> {team.members.join(', ')}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '6px' }}>
                        <span>Accuracy: <b>{team.accuracy}%</b></span>
                        <span>Stations Done: <b>{team.completedStations}/{PHASES.length}</b></span>
                      </div>
                    </div>

                    {/* Animated Runner Track */}
                    {(() => {
                      const progressPct = Math.round((team.completedStations / PHASES.length) * 100);
                      const isFinishedAll = team.completedStations >= PHASES.length;
                      return (
                        <div>
                          <div className="runner-progress-track" style={{ height: '22px', margin: '4px 0 6px 0' }}>
                            <div
                              className="runner-progress-fill"
                              style={{
                                width: `${Math.max(6, Math.min(100, progressPct))}%`,
                                background: team.color
                              }}
                            >
                              <div
                                className="runner-avatar-marker"
                                style={{ borderColor: team.color, color: team.color }}
                                title={`${team.name} runner (${progressPct}%)`}
                              >
                                <span className={isFinishedAll ? '' : 'runner-emoji-animated'}>
                                  {rankIdx === 0 && isFinishedAll ? '🥇' : isFinishedAll ? '🏅' : '🏃'}
                                </span>
                              </div>
                            </div>
                            <span
                              style={{
                                position: 'absolute',
                                right: '6px',
                                top: '50%',
                                transform: 'translateY(-50%)',
                                fontSize: '11px',
                                opacity: 0.5,
                                pointerEvents: 'none'
                              }}
                            >
                              🏁
                            </span>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '11px', fontWeight: 700, opacity: 0.8 }}>
                            <span>🏃 Pace: <b>{progressPct}% course completed</b></span>
                            <span style={{ color: team.color, fontWeight: 800 }}>
                              {isFinishedAll ? '🏁 Crossed Finish Line!' : `${team.completedStations} of ${PHASES.length} stations`}
                            </span>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                );
              })}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '16px' }}>
              <button className="btn btn-primary btn-sm" onClick={() => setShowStandingsModal(false)}>
                Close Standings
              </button>
            </div>
          </div>
        </div>
      )}

      {/* SCREEN: TEAM LOG IN (BEFORE PRETEST ACCESS) */}
      {screen === 'team_login' && (
        <div className="screen" id="screen-team-login">
          {renderSessionHeader()}
          <div className="coach-dash-card">
            <div className="coach-header">
              <div className="coach-avatar-badge">🏃</div>
              <div>
                <strong style={{ fontSize: '16px', fontFamily: 'Baloo 2' }}>Coach Dash</strong>
                <div style={{ fontSize: '11px', opacity: 0.7 }}>TEAM REGISTRATION &amp; LOG IN</div>
              </div>
            </div>
            <div className="coach-dialogue">
              &ldquo;Welcome, Relay Runners! Before entering the Race Map, log in with your team number, team name, and all 5 runners so we can assign your relay batons!&rdquo;
            </div>
          </div>

          <div className="item-card">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px', flexWrap: 'wrap', gap: '8px' }}>
              <div>
                <h2 style={{ fontSize: '20px', fontFamily: 'Baloo 2' }}>Relay Team Log In</h2>
                <div style={{ fontSize: '12px', opacity: 0.75, fontWeight: 700 }}>
                  Enter your team number, custom team name, and list of 5 runners.
                </div>
              </div>
              <span
                className="pill"
                style={{
                  background: GROUP_COLORS[loginTeamIndex],
                  color: '#fff',
                  fontSize: '12px',
                  fontWeight: 800
                }}
              >
                Team {loginTeamIndex + 1}
              </span>
            </div>

            {/* 1. Team Number Selection */}
            <div style={{ marginBottom: '16px' }}>
              <label style={{ fontSize: '12px', fontWeight: 800, display: 'block', marginBottom: '6px' }}>
                1. Select Team Number:
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '6px' }}>
                {[0, 1, 2, 3].map((idx) => {
                  const isSelected = loginTeamIndex === idx;
                  const color = GROUP_COLORS[idx];
                  return (
                    <button
                      key={idx}
                      type="button"
                      className={`team-tab-btn ${isSelected ? 'active' : ''}`}
                      style={{
                        padding: '10px 6px',
                        justifyContent: 'center',
                        borderColor: isSelected ? color : 'var(--line)',
                        background: isSelected ? color : 'var(--cream)',
                        color: isSelected ? '#fff' : 'var(--ink)',
                        boxShadow: isSelected ? '0 3px 6px rgba(0,0,0,0.15)' : 'none'
                      }}
                      onClick={() => handleSelectLoginTeam(idx)}
                    >
                      <span style={{ fontWeight: 800, fontSize: '13px' }}>Team {idx + 1}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 2. Team Name */}
            <div style={{ marginBottom: '16px' }}>
              <label style={{ fontSize: '12px', fontWeight: 800, display: 'block', marginBottom: '4px' }}>
                2. Team Name:
              </label>
              <input
                className="text-input"
                style={{ fontSize: '15px', fontWeight: 800 }}
                placeholder="e.g., Team 1 / Green Cheetahs"
                value={loginTeamName}
                onChange={(e) => {
                  setLoginTeamName(e.target.value);
                  setLoginError(null);
                }}
              />
            </div>

            {/* 3. The 5 Runners */}
            <div style={{ marginBottom: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                <label style={{ fontSize: '12px', fontWeight: 800 }}>
                  3. Enter The 5 Runners (Relay Positions):
                </label>
                <span className="team-cheer-badge" style={{ fontSize: '10px', padding: '2px 8px' }}>
                  5 RUNNERS REQUIRED
                </span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {loginRunners.map((runnerName, rIdx) => {
                  const role = RELAY_ROLES_INFO[rIdx % 5];
                  return (
                    <div
                      key={rIdx}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        background: 'var(--cream)',
                        border: '1.5px solid var(--line)',
                        borderRadius: '12px',
                        padding: '6px 10px'
                      }}
                    >
                      <span style={{ fontSize: '18px' }}>{role.icon}</span>
                      <div style={{ width: '95px', flexShrink: 0 }}>
                        <div style={{ fontSize: '11px', fontWeight: 800, fontFamily: 'Baloo 2' }}>
                          Runner {rIdx + 1}
                        </div>
                        <div style={{ fontSize: '9.5px', opacity: 0.7, fontWeight: 700 }}>
                          {role.title}
                        </div>
                      </div>
                      <input
                        className="text-input"
                        style={{ margin: 0, padding: '6px 10px', flex: 1, fontSize: '13px', fontWeight: 700 }}
                        placeholder={`Enter Runner ${rIdx + 1} Name`}
                        value={runnerName}
                        onChange={(e) => {
                          const updated = [...loginRunners];
                          updated[rIdx] = e.target.value;
                          setLoginRunners(updated);
                          setLoginError(null);
                        }}
                      />
                    </div>
                  );
                })}
              </div>
            </div>

            {loginError && (
              <div
                style={{
                  background: '#FCE7E4',
                  border: '1.5px solid var(--danger)',
                  color: 'var(--danger)',
                  padding: '9px 12px',
                  borderRadius: '10px',
                  fontSize: '12.5px',
                  fontWeight: 800,
                  marginBottom: '14px'
                }}
              >
                ⚠️ {loginError}
              </div>
            )}

            <button className="btn btn-primary" onClick={handleLoginSubmit}>
              [ LOG IN &amp; ENTER RACE ROAD MAP ➔ ]
            </button>
            {loggedTeamIndex !== null && (
              <button
                type="button"
                className="btn btn-ghost"
                style={{ marginTop: '8px' }}
                onClick={() => {
                  sounds.playTap();
                  setScreen('map');
                  window.scrollTo(0, 0);
                }}
              >
                Back to Race Map
              </button>
            )}
          </div>
        </div>
      )}

      {/* SCREEN: GROUP SELECTION */}
      {screen === 'groups' && (
        <div className="screen" id="screen-groups">
          {renderSessionHeader()}
          <div className="topbar" style={{ marginBottom: '8px' }}>
            <button
              className="icon-btn"
              onClick={() => {
                sounds.playTap();
                setScreen('map');
                window.scrollTo(0, 0);
              }}
              aria-label="Back to map"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <div className="pill">
              {activePhase.label} &middot; {activePhase.sub}
            </div>
            <div style={{ width: '40px' }} />
          </div>

          <h2 className="hero-line" style={{ marginBottom: '4px' }}>
            Select Your Relay Group
          </h2>
          <div className="hero-sub">
            4 groups &times; 5 runners. Each group shares 1 device and rotates 5 relay roles!
          </div>

          <div className="group-grid">
            {appState.groups.map((g, gi) => {
              const doneList = appState.completedToday[activePhase.key] || [];
              const isDone = doneList.includes(gi);
              return (
                <button
                  key={gi}
                  className="group-card"
                  style={{ background: GROUP_COLORS[gi % GROUP_COLORS.length] }}
                  onClick={() => handleGroupSelect(gi)}
                >
                  <span className="g-icon">🏃</span>
                  <span className="g-name">{g.name}</span>
                  <div className="g-sub">5 Runners &bull; Relay Rotation</div>
                  {isDone ? (
                    <span className="g-status">Completed Today ✅</span>
                  ) : (
                    <span className="g-status" style={{ background: 'rgba(255,255,255,0.35)' }}>
                      Ready to Race ➔
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* SCREEN: PRETEST WELCOME */}
      {screen === 'pretest_welcome' && (
        <div className="screen">
          {renderSessionHeader()}
          <div className="coach-dash-card">
            <div className="coach-header">
              <div className="coach-avatar-badge">🏃</div>
              <div>
                <strong style={{ fontSize: '16px', fontFamily: 'Baloo 2' }}>Coach Dash</strong>
                <div style={{ fontSize: '11px', opacity: 0.7 }}>Relay Head Coach</div>
              </div>
            </div>
            <div className="coach-dialogue">
              &ldquo;Hello, {appState.groups[session?.groupIndex ?? loginTeamIndex].name}! Welcome to the Gamified Grammar Relay! Let&apos;s take your 12-item Pretest to see what you already know about sentences and words.&rdquo;
            </div>
          </div>

          <div className="item-card" style={{ textAlign: 'center', padding: '24px 20px' }}>
            <div style={{ fontSize: '42px', marginBottom: '8px' }}>🏁</div>
            <h2 style={{ fontSize: '22px', marginBottom: '8px' }}>WELCOME TO THE RELAY!</h2>
            <div style={{ fontSize: '13px', fontWeight: 800, color: 'var(--track-dark)', marginBottom: '10px' }}>
              Logged in: {appState.groups[session?.groupIndex ?? loginTeamIndex].name} &bull; 5 Runners Ready
            </div>
            <p style={{ fontSize: '13.5px', opacity: 0.8, lineHeight: 1.6, marginBottom: '20px' }}>
              Standard test conditions &mdash; 12 baseline items, no timer, individual seatwork, adequate time allotment.
            </p>
            <button
              className="btn btn-primary"
              onClick={() => {
                sounds.playTap();
                setScreen('pretest_orientation');
                window.scrollTo(0, 0);
              }}
            >
              [ START PRETEST ]
            </button>
          </div>
        </div>
      )}

      {/* SCREEN: PRETEST ORIENTATION */}
      {screen === 'pretest_orientation' && (
        <div className="screen">
          {renderSessionHeader()}
          <div className="coach-dash-card">
            <div className="coach-header">
              <div className="coach-avatar-badge">🏃</div>
              <div>
                <strong style={{ fontSize: '16px', fontFamily: 'Baloo 2' }}>Coach Dash</strong>
                <div style={{ fontSize: '11px', opacity: 0.7 }}>ORIENTATION</div>
              </div>
            </div>
            <div className="coach-dialogue">
              &ldquo;Answer each item on your own first. There&apos;s no timer here - take your time and do your best on all 12 items!&rdquo;
            </div>
          </div>

          <div className="item-card" style={{ textAlign: 'center', padding: '24px 20px' }}>
            <h2 style={{ fontSize: '20px', marginBottom: '10px' }}>Pretest Instructions</h2>
            <ul style={{ textAlign: 'left', fontSize: '13px', lineHeight: 1.7, opacity: 0.85, marginBottom: '20px', paddingLeft: '18px' }}>
              <li>12 items covering Basic Sentence Construction and Parts of Speech.</li>
              <li>Read each question carefully before choosing your answer.</li>
              <li>No timer &mdash; do your best!</li>
            </ul>
            <button
              className="btn btn-primary"
              onClick={() => {
                sounds.playTap();
                setScreen('turn');
                window.scrollTo(0, 0);
              }}
            >
              [ BEGIN 12 ITEMS ]
            </button>
          </div>
        </div>
      )}

      {/* SCREEN: PRETEST COMPLETE */}
      {screen === 'pretest_complete' && (
        <div className="screen">
          {renderSessionHeader()}
          <div className="end-wrap">
            <Mascot type="cheer" isBig />
            <div className="end-badge">🏅</div>
            <div className="end-title display">PRETEST COMPLETE</div>
            <div className="coach-dash-card" style={{ textAlign: 'left', marginTop: '16px' }}>
              <div className="coach-header">
                <div className="coach-avatar-badge">🏃</div>
                <div>
                  <strong style={{ fontSize: '16px', fontFamily: 'Baloo 2' }}>Coach Dash</strong>
                </div>
              </div>
              <div className="coach-dialogue">
                &ldquo;Great job completing all 12 items! This is your baseline score before the relay begins. Let&apos;s head to Mission 1!&rdquo;
              </div>
            </div>
            <button
              className="btn btn-primary"
              style={{ marginTop: '16px' }}
              onClick={() => {
                sounds.playTap();
                setScreen('map');
                window.scrollTo(0, 0);
              }}
            >
              Back to Race Map
            </button>
          </div>
        </div>
      )}

      {/* SCREEN: MISSION UNLOCKED */}
      {screen === 'mission_unlocked' && activeMissionCurriculum && (
        <div className="screen">
          {renderSessionHeader()}
          <div className="coach-dash-card">
            <div className="coach-header">
              <div className="coach-avatar-badge">🏃</div>
              <div>
                <strong style={{ fontSize: '16px', fontFamily: 'Baloo 2' }}>Coach Dash</strong>
                <div style={{ fontSize: '11px', opacity: 0.7 }}>
                  MISSION {activeMissionCurriculum.missionNumber} UNLOCKED!
                </div>
              </div>
            </div>
            <div className="coach-dialogue">
              &ldquo;{activeMissionCurriculum.briefing.welcome}&rdquo;
            </div>
          </div>

          <div className="item-card">
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
              <span style={{ fontSize: '24px' }}>{activePhase.icon}</span>
              <div>
                <h2 style={{ fontSize: '20px' }}>
                  MISSION {activeMissionCurriculum.missionNumber} &mdash; {activePhase.weekLabel}
                </h2>
                <div style={{ fontSize: '12px', fontWeight: 800, color: 'var(--sky)' }}>
                  {activeMissionCurriculum.title} &bull; {activeMissionCurriculum.subtitle}
                </div>
              </div>
            </div>

            <div style={{ fontSize: '11px', fontWeight: 800, opacity: 0.6, marginBottom: '6px', textTransform: 'uppercase' }}>
              Domain: {activeMissionCurriculum.domain}
            </div>

            <div style={{ fontSize: '13px', fontWeight: 700, marginBottom: '6px' }}>
              Today you will learn how to:
            </div>
            <ul style={{ fontSize: '13px', lineHeight: 1.7, opacity: 0.9, paddingLeft: '18px', marginBottom: '16px' }}>
              {activeMissionCurriculum.briefing.objectives.map((obj, i) => (
                <li key={i}>{obj}</li>
              ))}
            </ul>

            <button
              className="btn btn-primary"
              onClick={() => {
                sounds.playTap();
                setScreen('how_to_play');
                window.scrollTo(0, 0);
              }}
            >
              [ START MISSION {activeMissionCurriculum.missionNumber} ]
            </button>
          </div>
        </div>
      )}

      {/* SCREEN: HOW TO PLAY */}
      {screen === 'how_to_play' && (
        <div className="screen">
          {renderSessionHeader()}
          <div className="coach-dash-card">
            <div className="coach-header">
              <div className="coach-avatar-badge">🏃</div>
              <div>
                <strong style={{ fontSize: '16px', fontFamily: 'Baloo 2' }}>Coach Dash</strong>
                <div style={{ fontSize: '11px', opacity: 0.7 }}>HOW TO PLAY</div>
              </div>
            </div>
            <div className="coach-dialogue">
              &ldquo;You&apos;ll race through this mission as a team. Listen, think, discuss, then run!&rdquo;
            </div>
          </div>

          <div className="item-card">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
              <h2 style={{ fontSize: '18px' }}>5 Team Relay Roles</h2>
              <span className="team-cheer-badge">ROTATE EACH CHALLENGE</span>
            </div>
            <p style={{ fontSize: '13px', opacity: 0.8, marginBottom: '12px' }}>
              Every group of 5 shares one device and rotates these relay roles after each challenge:
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '16px' }}>
              {RELAY_ROLES_INFO.map((r, i) => (
                <div
                  key={i}
                  style={{
                    background: 'var(--cream)',
                    border: '1.5px solid var(--line)',
                    borderRadius: '12px',
                    padding: '8px 12px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px'
                  }}
                >
                  <span style={{ fontSize: '22px' }}>{r.icon}</span>
                  <div>
                    <strong style={{ fontSize: '13px', fontFamily: 'Baloo 2' }}>{r.title}</strong>
                    <div style={{ fontSize: '11.5px', opacity: 0.8 }}>{r.duty}</div>
                  </div>
                </div>
              ))}
            </div>

            <div
              style={{
                textAlign: 'center',
                background: 'var(--cream-2)',
                padding: '10px',
                borderRadius: '12px',
                marginBottom: '16px',
                fontFamily: 'Baloo 2',
                fontWeight: 800,
                fontSize: '14px',
                color: 'var(--baton-dark)'
              }}
            >
              Team Cheer: &ldquo;READ • THINK • DISCUSS • RUN!&rdquo;
            </div>

            <button
              className="btn btn-primary"
              onClick={() => {
                sounds.playTap();
                setIDoSubStep(0);
                setScreen('i_do');
                window.scrollTo(0, 0);
              }}
            >
              [ GOT IT! LET&apos;S GO ]
            </button>
          </div>
        </div>
      )}

      {/* SCREEN: I DO */}
      {screen === 'i_do' && activeMissionCurriculum && (
        <div className="screen">
          {renderSessionHeader()}
          {renderRelayRolesBar(currentGroup.members, 0)}
          <div className="instruction-stage-beads">
            <span className="stage-bead active">I DO ➔</span>
            <span className="stage-bead">WE DO ➔</span>
            <span className="stage-bead">YOU DO 🏁</span>
          </div>

          <div className="coach-dash-card">
            <div className="coach-header">
              <div className="coach-avatar-badge">🏃</div>
              <div>
                <strong style={{ fontSize: '16px', fontFamily: 'Baloo 2' }}>Coach Dash</strong>
                <div style={{ fontSize: '11px', opacity: 0.7 }}>I DO &mdash; WATCH ME FIRST!</div>
              </div>
            </div>
            <div className="coach-dialogue">
              &ldquo;{activeMissionCurriculum.iDo.coachMessage}&rdquo;
            </div>
          </div>

          {iDoSubStep === 0 && (
            <div className="item-card">
              <h2 style={{ fontSize: '18px', marginBottom: '8px' }}>Essential Grammar Rules</h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '16px' }}>
                {activeMissionCurriculum.iDo.rules.map((r, i) => (
                  <div
                    key={i}
                    style={{
                      background: 'var(--cream)',
                      border: '1.5px solid var(--line)',
                      padding: '10px 12px',
                      borderRadius: '12px',
                      fontWeight: 700,
                      fontSize: '13.5px'
                    }}
                  >
                    {r}
                  </div>
                ))}
              </div>
              <button
                className="btn btn-primary"
                onClick={() => {
                  sounds.playTap();
                  setIDoSubStep(1);
                  window.scrollTo(0, 0);
                }}
              >
                [ SHOW ME AN EXAMPLE ]
              </button>
            </div>
          )}

          {iDoSubStep === 1 && activeMissionCurriculum.iDo.examples[0] && (() => {
            const ex = activeMissionCurriculum.iDo.examples[0];
            return (
              <div className="item-card">
                <div className="item-eyebrow">EXAMPLE 1 &mdash; COMPLETE DEMONSTRATION</div>
                <div
                  style={{
                    fontSize: '18px',
                    fontWeight: 800,
                    marginBottom: '14px',
                    background: 'var(--cream-2)',
                    padding: '12px',
                    borderRadius: '12px'
                  }}
                >
                  &ldquo;{ex.text}&rdquo;
                </div>
                <div className="chunk-analysis-wrap">
                  {ex.analysis.map((an, i) => (
                    <div key={i} className="chunk-card">
                      <div className="chunk-label">
                        <span>{an.icon}</span>
                        <span>{an.label}</span>
                      </div>
                      <div>{an.text}</div>
                    </div>
                  ))}
                </div>
                <p style={{ fontSize: '13px', opacity: 0.8, margin: '14px 0', lineHeight: 1.5 }}>
                  {ex.explanation}
                </p>
                <button
                  className="btn btn-primary"
                  onClick={() => {
                    sounds.playTap();
                    setIDoSubStep(2);
                    window.scrollTo(0, 0);
                  }}
                >
                  [ NEXT STEP ]
                </button>
              </div>
            );
          })()}

          {iDoSubStep === 2 && (
            <div className="item-card">
              <div className="item-eyebrow">COACH DASH&apos;S GUIDE</div>
              <h2 style={{ fontSize: '18px', marginBottom: '8px' }}>
                {activeMissionCurriculum.iDo.guideSummary.title}
              </h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '14px' }}>
                {activeMissionCurriculum.iDo.guideSummary.steps.map((st, i) => (
                  <div
                    key={i}
                    style={{
                      background: 'var(--cream)',
                      border: '1.5px solid var(--line)',
                      padding: '10px 12px',
                      borderRadius: '12px',
                      fontSize: '13px',
                      fontWeight: 700
                    }}
                  >
                    {st}
                  </div>
                ))}
              </div>
              {activeMissionCurriculum.iDo.guideSummary.formula && (
                <div
                  style={{
                    background: '#E4F7EC',
                    border: '2px solid var(--track)',
                    color: 'var(--track-dark)',
                    padding: '10px 14px',
                    borderRadius: '12px',
                    fontWeight: 800,
                    fontSize: '13px',
                    textAlign: 'center',
                    marginBottom: '16px'
                  }}
                >
                  ⚡ Easy Reminder: {activeMissionCurriculum.iDo.guideSummary.formula}
                </div>
              )}
              <button
                className="btn btn-primary"
                onClick={() => {
                  sounds.playTap();
                  setIDoSubStep(3);
                  setInteractiveSelectedAnswer(null);
                  setInteractiveFeedback(null);
                  window.scrollTo(0, 0);
                }}
              >
                [ PRACTICE QUICK CHECK ]
              </button>
            </div>
          )}

          {iDoSubStep === 3 && (() => {
            const qc = activeMissionCurriculum.iDo.quickCheck;
            return (
              <div className="item-card">
                <div className="item-eyebrow">QUICK I DO CHECK</div>
                <div style={{ fontSize: '16px', fontWeight: 800, marginBottom: '14px' }}>
                  {qc.question}
                </div>
                <div className="options-grid">
                  {qc.options.map((opt, i) => {
                    const isSelected = interactiveSelectedAnswer === i;
                    const isCorrect = i === qc.correct;
                    let extra = '';
                    if (interactiveSelectedAnswer !== null) {
                      extra = isCorrect ? 'correct' : isSelected ? 'wrong' : '';
                    }
                    return (
                      <button
                        key={i}
                        className={`option-btn ${extra}`}
                        disabled={interactiveSelectedAnswer !== null}
                        onClick={() => {
                          sounds.playTap();
                          setInteractiveSelectedAnswer(i);
                          if (i === qc.correct) {
                            sounds.playCorrect();
                            setInteractiveFeedback({ isCorrect: true, message: qc.explanation });
                          } else {
                            sounds.playWrong();
                            setInteractiveFeedback({
                              isCorrect: false,
                              message: `Not quite! ${qc.explanation}`
                            });
                          }
                        }}
                      >
                        <span className="opt-letter">{letters[i]}</span>
                        <span>{opt}</span>
                      </button>
                    );
                  })}
                </div>
                {interactiveFeedback && (
                  <div
                    style={{
                      background: interactiveFeedback.isCorrect ? '#E4F7EC' : '#FCE7E4',
                      border: `2px solid ${interactiveFeedback.isCorrect ? 'var(--track)' : 'var(--danger)'}`,
                      borderRadius: '12px',
                      padding: '10px 14px',
                      marginTop: '14px',
                      fontSize: '13px',
                      fontWeight: 700
                    }}
                  >
                    {interactiveFeedback.message}
                  </div>
                )}
                {interactiveSelectedAnswer !== null && (
                  <button
                    className="btn btn-primary"
                    style={{ marginTop: '16px' }}
                    onClick={() => {
                      sounds.playTap();
                      setWeDoSubStep(0);
                      setInteractiveSelectedAnswer(null);
                      setInteractiveFeedback(null);
                      setScreen('we_do');
                      window.scrollTo(0, 0);
                    }}
                  >
                    [ START WE DO GROUP PRACTICE ]
                  </button>
                )}
              </div>
            );
          })()}
        </div>
      )}

      {/* SCREEN: WE DO */}
      {screen === 'we_do' && activeMissionCurriculum && (() => {
        const challenge = activeMissionCurriculum.weDo.challenges[weDoSubStep] || activeMissionCurriculum.weDo.challenges[0];
        return (
          <div className="screen">
            {renderSessionHeader()}
            {renderRelayRolesBar(currentGroup.members, weDoSubStep + 1)}
            <div className="instruction-stage-beads">
              <span className="stage-bead">I DO ➔</span>
              <span className="stage-bead active">WE DO ➔</span>
              <span className="stage-bead">YOU DO 🏁</span>
            </div>

            <div className="coach-dash-card">
              <div className="coach-header">
                <div className="coach-avatar-badge">🏃</div>
                <div>
                  <strong style={{ fontSize: '16px', fontFamily: 'Baloo 2' }}>Coach Dash</strong>
                  <div style={{ fontSize: '11px', opacity: 0.7 }}>WE DO &mdash; PRACTICE TOGETHER!</div>
                </div>
              </div>
              <div className="coach-dialogue">
                &ldquo;{activeMissionCurriculum.weDo.coachMessage}&rdquo;
              </div>
            </div>

            <div style={{ textAlign: 'right' }}>
              <button
                type="button"
                className="hint-toggle-btn"
                onClick={() => {
                  sounds.playTap();
                  setShowHintBox(!showHintBox);
                }}
              >
                💡 {showHintBox ? 'Close Hints' : 'Need a Hint?'}
              </button>
            </div>

            {showHintBox && (
              <div className="hint-box">
                <strong style={{ fontSize: '12.5px', color: '#B45309', display: 'block', marginBottom: '6px' }}>
                  Coach Dash&apos;s Hints:
                </strong>
                {activeMissionCurriculum.weDo.hints.map((h, i) => (
                  <div key={i} className="hint-item">
                    {h}
                  </div>
                ))}
              </div>
            )}

            <div className="item-card">
              <div className="item-eyebrow">
                {challenge.title} ({weDoSubStep + 1} of {activeMissionCurriculum.weDo.challenges.length})
              </div>
              <div style={{ fontSize: '16px', fontWeight: 800, marginBottom: '14px' }}>
                {challenge.prompt}
              </div>

              <div
                style={{
                  background: 'var(--cream)',
                  border: '1px solid var(--line)',
                  padding: '8px 12px',
                  borderRadius: '10px',
                  fontSize: '11px',
                  fontWeight: 700,
                  opacity: 0.85,
                  marginBottom: '12px'
                }}
              >
                🏃 <b>Group task:</b> Reader reads ➔ Solver answers ➔ Checker checks ➔ Explainer explains ➔ Runner taps.
              </div>

              <div className="options-grid">
                {challenge.options.map((opt, i) => {
                  const isSelected = interactiveSelectedAnswer === i;
                  const isCorrect = i === challenge.correct;
                  let extra = '';
                  if (interactiveSelectedAnswer !== null) {
                    extra = isCorrect ? 'correct' : isSelected ? 'wrong' : '';
                  }
                  return (
                    <button
                      key={i}
                      className={`option-btn ${extra}`}
                      disabled={interactiveSelectedAnswer !== null}
                      onClick={() => {
                        sounds.playTap();
                        setInteractiveSelectedAnswer(i);
                        if (i === challenge.correct) {
                          sounds.playCorrect();
                          setInteractiveFeedback({ isCorrect: true, message: challenge.explanation });
                        } else {
                          sounds.playWrong();
                          setInteractiveFeedback({
                            isCorrect: false,
                            message: `Close! ${challenge.explanation}`
                          });
                        }
                      }}
                    >
                      <span className="opt-letter">{letters[i]}</span>
                      <span>{opt}</span>
                    </button>
                  );
                })}
              </div>

              {interactiveFeedback && (
                <div
                  style={{
                    background: interactiveFeedback.isCorrect ? '#E4F7EC' : '#FCE7E4',
                    border: `2px solid ${interactiveFeedback.isCorrect ? 'var(--track)' : 'var(--danger)'}`,
                    borderRadius: '12px',
                    padding: '10px 14px',
                    marginTop: '14px',
                    fontSize: '13px',
                    fontWeight: 700
                  }}
                >
                  {interactiveFeedback.message}
                </div>
              )}

              {interactiveSelectedAnswer !== null && (
                <button
                  className="btn btn-primary"
                  style={{ marginTop: '16px' }}
                  onClick={() => {
                    sounds.playTap();
                    setInteractiveSelectedAnswer(null);
                    setInteractiveFeedback(null);
                    if (weDoSubStep + 1 < activeMissionCurriculum.weDo.challenges.length) {
                      setWeDoSubStep(weDoSubStep + 1);
                      window.scrollTo(0, 0);
                    } else {
                      setSession({
                        phaseIndex: selectedPhaseIndex,
                        groupIndex: session ? session.groupIndex : 0,
                        itemOrder: Array.from({ length: activePhase.itemCount }, (_, i) => i),
                        itemIndex: 0,
                        turnPlayerIndex: 0
                      });
                      setScreen('you_do_intro');
                      window.scrollTo(0, 0);
                    }
                  }}
                >
                  {weDoSubStep + 1 < activeMissionCurriculum.weDo.challenges.length
                    ? '[ NEXT CHALLENGE ]'
                    : '[ READY FOR YOU DO! ]'}
                </button>
              )}
            </div>
          </div>
        );
      })()}

      {/* SCREEN: YOU DO INTRO */}
      {screen === 'you_do_intro' && activeMissionCurriculum && (
        <div className="screen">
          {renderSessionHeader()}
          <div className="instruction-stage-beads">
            <span className="stage-bead">I DO ➔</span>
            <span className="stage-bead">WE DO ➔</span>
            <span className="stage-bead active">YOU DO 🏁</span>
          </div>

          <div className="coach-dash-card">
            <div className="coach-header">
              <div className="coach-avatar-badge">🏃</div>
              <div>
                <strong style={{ fontSize: '16px', fontFamily: 'Baloo 2' }}>Coach Dash</strong>
                <div style={{ fontSize: '11px', opacity: 0.7 }}>YOU DO &mdash; YOUR TURN!</div>
              </div>
            </div>
            <div className="coach-dialogue">
              &ldquo;{activeMissionCurriculum.youDo.coachMessage}&rdquo;
            </div>
          </div>

          <div className="item-card" style={{ textAlign: 'center', padding: '24px 20px' }}>
            <h2 style={{ fontSize: '20px', marginBottom: '8px' }}>Relay Main Stretch • Lap 1</h2>
            <p style={{ fontSize: '13px', opacity: 0.8, lineHeight: 1.6, marginBottom: '20px' }}>
              Rotate roles after every question! Everyone thinks first; the Runner taps the group&apos;s final answer.
            </p>
            <button
              className="btn btn-primary"
              onClick={() => {
                sounds.playTap();
                setScreen('turn');
                window.scrollTo(0, 0);
              }}
            >
              [ START YOU DO ]
            </button>
          </div>
        </div>
      )}

      {/* SCREEN: BONUS LAP 1 UNLOCKED */}
      {screen === 'bonus_lap_1_unlocked' && activeMissionCurriculum?.bonusLap1 && (
        <div className="screen">
          {renderSessionHeader()}
          <div className="coach-dash-card">
            <div className="coach-header">
              <div className="coach-avatar-badge">🏃</div>
              <div>
                <strong style={{ fontSize: '16px', fontFamily: 'Baloo 2' }}>Coach Dash</strong>
                <div style={{ fontSize: '11px', opacity: 0.7 }}>⚡ BONUS LAP UNLOCKED!</div>
              </div>
            </div>
            <div className="coach-dialogue">
              &ldquo;{activeMissionCurriculum.bonusLap1.unlockedDialogue}&rdquo;
            </div>
          </div>

          <div className="item-card" style={{ textAlign: 'center', padding: '24px 20px' }}>
            <div style={{ fontSize: '48px', marginBottom: '8px' }}>⚡</div>
            <h2 style={{ fontSize: '22px', marginBottom: '8px' }}>BONUS LAP 1 • EXTRA TURN!</h2>
            <p style={{ fontSize: '13.5px', opacity: 0.8, lineHeight: 1.6, marginBottom: '20px' }}>
              Great run on the main course! Ready for an extra lap? New sentences, same skills &mdash; let&apos;s keep those legs warm!
            </p>
            <button
              className="btn btn-primary"
              onClick={() => {
                sounds.playTap();
                setScreen('bonus_lap_1_i_do');
                window.scrollTo(0, 0);
              }}
            >
              [ START BONUS LAP ]
            </button>
          </div>
        </div>
      )}

      {/* SCREEN: BONUS LAP 1 I DO */}
      {screen === 'bonus_lap_1_i_do' && activeMissionCurriculum?.bonusLap1 && (
        <div className="screen">
          {renderSessionHeader()}
          {renderRelayRolesBar(currentGroup.members, 5)}
          <div className="instruction-stage-beads">
            <span className="stage-bead active">BONUS 1: I DO ➔</span>
            <span className="stage-bead">BONUS 1: WE DO ➔</span>
            <span className="stage-bead">BONUS 1: YOU DO 🏁</span>
          </div>

          <div className="coach-dash-card">
            <div className="coach-header">
              <div className="coach-avatar-badge">🏃</div>
              <div>
                <strong style={{ fontSize: '16px', fontFamily: 'Baloo 2' }}>Coach Dash</strong>
                <div style={{ fontSize: '11px', opacity: 0.7 }}>COACH DASH&apos;S EXTRA TURN</div>
              </div>
            </div>
            <div className="coach-dialogue">
              &ldquo;{activeMissionCurriculum.bonusLap1.iDo.coachMessage}&rdquo;
            </div>
          </div>

          <div className="item-card">
            <div className="item-eyebrow">EXTRA DEMONSTRATIONS</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '16px' }}>
              {activeMissionCurriculum.bonusLap1.iDo.displays.map((disp, i) => (
                <div
                  key={i}
                  style={{
                    background: disp.type === 'incomplete' ? '#FFF3F0' : 'var(--cream)',
                    border: `1.5px solid ${disp.type === 'incomplete' ? 'var(--danger)' : 'var(--line)'}`,
                    borderRadius: '14px',
                    padding: '12px 14px'
                  }}
                >
                  <div style={{ fontSize: '16px', fontWeight: 800, marginBottom: '6px' }}>
                    {disp.type === 'incomplete' ? '⚠️ ' : '✅ '}&ldquo;{disp.text}&rdquo;
                  </div>
                  <div style={{ fontSize: '13px', opacity: 0.85, lineHeight: 1.5, marginBottom: disp.fix ? '8px' : '0' }}>
                    {disp.coachExplanation}
                  </div>
                  {disp.fix && (
                    <div style={{ background: '#E4F7EC', border: '1px solid var(--track)', padding: '6px 10px', borderRadius: '8px', fontSize: '12px', fontWeight: 800, color: 'var(--track-dark)', marginTop: '6px' }}>
                      💡 Fix: &ldquo;{disp.fix}&rdquo;
                    </div>
                  )}
                </div>
              ))}
            </div>

            {activeMissionCurriculum.bonusLap1.iDo.formula && (
              <div
                style={{
                  background: '#FFF8E1',
                  border: '2px solid #FCD34D',
                  color: '#92400E',
                  padding: '10px 14px',
                  borderRadius: '12px',
                  fontWeight: 800,
                  fontSize: '12.5px',
                  textAlign: 'center',
                  marginBottom: '16px'
                }}
              >
                {activeMissionCurriculum.bonusLap1.iDo.formula}
              </div>
            )}

            <button
              className="btn btn-primary"
              onClick={() => {
                sounds.playTap();
                setBonusWeDoIndex(0);
                setInteractiveSelectedAnswer(null);
                setInteractiveFeedback(null);
                setScreen('bonus_lap_1_we_do');
                window.scrollTo(0, 0);
              }}
            >
              [ I UNDERSTAND • PRACTICE TOGETHER ]
            </button>
          </div>
        </div>
      )}

      {/* SCREEN: BONUS LAP 1 WE DO */}
      {screen === 'bonus_lap_1_we_do' && activeMissionCurriculum?.bonusLap1 && (() => {
        const challenges = activeMissionCurriculum.bonusLap1.weDo.challenges;
        const currentChallenge = challenges[bonusWeDoIndex] || challenges[0];
        return (
          <div className="screen">
            {renderSessionHeader()}
            {renderRelayRolesBar(currentGroup.members, 5 + bonusWeDoIndex + 1)}
            <div className="instruction-stage-beads">
              <span className="stage-bead">BONUS 1: I DO ➔</span>
              <span className="stage-bead active">BONUS 1: WE DO ➔</span>
              <span className="stage-bead">BONUS 1: YOU DO 🏁</span>
            </div>

            <div className="coach-dash-card">
              <div className="coach-header">
                <div className="coach-avatar-badge">🏃</div>
                <div>
                  <strong style={{ fontSize: '16px', fontFamily: 'Baloo 2' }}>Coach Dash</strong>
                  <div style={{ fontSize: '11px', opacity: 0.7 }}>BONUS WE DO PRACTICE</div>
                </div>
              </div>
              <div className="coach-dialogue">
                &ldquo;{activeMissionCurriculum.bonusLap1.weDo.coachMessage}&rdquo;
              </div>
            </div>

            <div className="item-card">
              <div className="item-eyebrow">
                {currentChallenge.title} ({bonusWeDoIndex + 1} of {challenges.length})
              </div>
              <div style={{ fontSize: '16px', fontWeight: 800, marginBottom: '14px' }}>
                {currentChallenge.prompt}
              </div>

              <div className="options-grid">
                {currentChallenge.options.map((opt, i) => {
                  const isSelected = interactiveSelectedAnswer === i;
                  const isCorrect = i === currentChallenge.correct;
                  let extra = '';
                  if (interactiveSelectedAnswer !== null) {
                    extra = isCorrect ? 'correct' : isSelected ? 'wrong' : '';
                  }
                  return (
                    <button
                      key={i}
                      className={`option-btn ${extra}`}
                      disabled={interactiveSelectedAnswer !== null}
                      onClick={() => {
                        sounds.playTap();
                        setInteractiveSelectedAnswer(i);
                        if (i === currentChallenge.correct) {
                          sounds.playCorrect();
                          setInteractiveFeedback({ isCorrect: true, message: currentChallenge.explanation });
                        } else {
                          sounds.playWrong();
                          setInteractiveFeedback({
                            isCorrect: false,
                            message: `Close! ${currentChallenge.explanation}`
                          });
                        }
                      }}
                    >
                      <span className="opt-letter">{letters[i]}</span>
                      <span>{opt}</span>
                    </button>
                  );
                })}
              </div>

              {interactiveFeedback && (
                <div
                  style={{
                    background: interactiveFeedback.isCorrect ? '#E4F7EC' : '#FCE7E4',
                    border: `2px solid ${interactiveFeedback.isCorrect ? 'var(--track)' : 'var(--danger)'}`,
                    borderRadius: '12px',
                    padding: '10px 14px',
                    marginTop: '14px',
                    fontSize: '13px',
                    fontWeight: 700
                  }}
                >
                  {interactiveFeedback.message}
                </div>
              )}

              {interactiveSelectedAnswer !== null && (
                <button
                  className="btn btn-primary"
                  style={{ marginTop: '16px' }}
                  onClick={() => {
                    sounds.playTap();
                    setInteractiveSelectedAnswer(null);
                    setInteractiveFeedback(null);
                    if (bonusWeDoIndex + 1 < challenges.length) {
                      setBonusWeDoIndex(bonusWeDoIndex + 1);
                      window.scrollTo(0, 0);
                    } else {
                      setScreen('bonus_lap_1_you_do_intro');
                      window.scrollTo(0, 0);
                    }
                  }}
                >
                  {bonusWeDoIndex + 1 < challenges.length
                    ? '[ NEXT CHALLENGE ]'
                    : '[ READY FOR BONUS YOU DO ]'}
                </button>
              )}
            </div>
          </div>
        );
      })()}

      {/* SCREEN: BONUS LAP 1 YOU DO INTRO */}
      {screen === 'bonus_lap_1_you_do_intro' && activeMissionCurriculum?.bonusLap1 && (
        <div className="screen">
          {renderSessionHeader()}
          <div className="instruction-stage-beads">
            <span className="stage-bead">BONUS 1: I DO ➔</span>
            <span className="stage-bead">BONUS 1: WE DO ➔</span>
            <span className="stage-bead active">BONUS 1: YOU DO 🏁</span>
          </div>

          <div className="coach-dash-card">
            <div className="coach-header">
              <div className="coach-avatar-badge">🏃</div>
              <div>
                <strong style={{ fontSize: '16px', fontFamily: 'Baloo 2' }}>Coach Dash</strong>
                <div style={{ fontSize: '11px', opacity: 0.7 }}>BONUS YOU DO &mdash; YOUR TURN!</div>
              </div>
            </div>
            <div className="coach-dialogue">
              &ldquo;{activeMissionCurriculum.bonusLap1.youDo.coachMessage}&rdquo;
            </div>
          </div>

          <div className="item-card" style={{ textAlign: 'center', padding: '24px 20px' }}>
            <h2 style={{ fontSize: '20px', marginBottom: '8px' }}>Bonus Lap 1 Challenge!</h2>
            <p style={{ fontSize: '13px', opacity: 0.8, lineHeight: 1.6, marginBottom: '20px' }}>
              Think first, then the Runner taps the group&apos;s final answer. No hints this time!
            </p>
            <button
              className="btn btn-primary"
              onClick={() => {
                sounds.playTap();
                setScreen('turn');
                window.scrollTo(0, 0);
              }}
            >
              [ START BONUS YOU DO ]
            </button>
          </div>
        </div>
      )}

      {/* SCREEN: BONUS LAP 2 UNLOCKED */}
      {screen === 'bonus_lap_2_unlocked' && activeMissionCurriculum?.bonusLap2 && (
        <div className="screen">
          {renderSessionHeader()}
          <div className="coach-dash-card">
            <div className="coach-header">
              <div className="coach-avatar-badge">🏃</div>
              <div>
                <strong style={{ fontSize: '16px', fontFamily: 'Baloo 2' }}>Coach Dash</strong>
                <div style={{ fontSize: '11px', opacity: 0.7 }}>⚡ BONUS LAP 2 UNLOCKED!</div>
              </div>
            </div>
            <div className="coach-dialogue">
              &ldquo;{activeMissionCurriculum.bonusLap2.unlockedDialogue}&rdquo;
            </div>
          </div>

          <div className="item-card" style={{ textAlign: 'center', padding: '24px 20px' }}>
            <div style={{ fontSize: '48px', marginBottom: '8px' }}>⚡</div>
            <h2 style={{ fontSize: '22px', marginBottom: '8px' }}>BONUS LAP 2 • CHAMPION EXTRA TURN!</h2>
            <p style={{ fontSize: '13.5px', opacity: 0.8, lineHeight: 1.6, marginBottom: '20px' }}>
              Two laps done, Relay Runners &mdash; and you&apos;re still running strong! Here&apos;s one more with brand-new sentences!
            </p>
            <button
              className="btn btn-primary"
              onClick={() => {
                sounds.playTap();
                setScreen('bonus_lap_2_i_do');
                window.scrollTo(0, 0);
              }}
            >
              [ START BONUS LAP 2 ]
            </button>
          </div>
        </div>
      )}

      {/* SCREEN: BONUS LAP 2 I DO */}
      {screen === 'bonus_lap_2_i_do' && activeMissionCurriculum?.bonusLap2 && (
        <div className="screen">
          {renderSessionHeader()}
          {renderRelayRolesBar(currentGroup.members, 10)}
          <div className="instruction-stage-beads">
            <span className="stage-bead active">BONUS 2: I DO ➔</span>
            <span className="stage-bead">BONUS 2: WE DO ➔</span>
            <span className="stage-bead">BONUS 2: YOU DO 🏁</span>
          </div>

          <div className="coach-dash-card">
            <div className="coach-header">
              <div className="coach-avatar-badge">🏃</div>
              <div>
                <strong style={{ fontSize: '16px', fontFamily: 'Baloo 2' }}>Coach Dash</strong>
                <div style={{ fontSize: '11px', opacity: 0.7 }}>BONUS LAP 2 &mdash; COACH DASH&apos;S TURN</div>
              </div>
            </div>
            <div className="coach-dialogue">
              &ldquo;{activeMissionCurriculum.bonusLap2.iDo.coachMessage}&rdquo;
            </div>
          </div>

          <div className="item-card">
            <div className="item-eyebrow">CHAMPION DEMONSTRATIONS</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '16px' }}>
              {activeMissionCurriculum.bonusLap2.iDo.displays.map((disp, i) => (
                <div
                  key={i}
                  style={{
                    background: disp.type === 'incomplete' ? '#FFF3F0' : 'var(--cream)',
                    border: `1.5px solid ${disp.type === 'incomplete' ? 'var(--danger)' : 'var(--line)'}`,
                    borderRadius: '14px',
                    padding: '12px 14px'
                  }}
                >
                  <div style={{ fontSize: '16px', fontWeight: 800, marginBottom: '6px' }}>
                    {disp.type === 'incomplete' ? '⚠️ ' : '✅ '}&ldquo;{disp.text}&rdquo;
                  </div>
                  <div style={{ fontSize: '13px', opacity: 0.85, lineHeight: 1.5, marginBottom: disp.fix ? '8px' : '0' }}>
                    {disp.coachExplanation}
                  </div>
                  {disp.fix && (
                    <div style={{ background: '#E4F7EC', border: '1px solid var(--track)', padding: '6px 10px', borderRadius: '8px', fontSize: '12px', fontWeight: 800, color: 'var(--track-dark)', marginTop: '6px' }}>
                      💡 Fix: &ldquo;{disp.fix}&rdquo;
                    </div>
                  )}
                </div>
              ))}
            </div>

            {activeMissionCurriculum.bonusLap2.iDo.formula && (
              <div
                style={{
                  background: '#FFF8E1',
                  border: '2px solid #FCD34D',
                  color: '#92400E',
                  padding: '10px 14px',
                  borderRadius: '12px',
                  fontWeight: 800,
                  fontSize: '12.5px',
                  textAlign: 'center',
                  marginBottom: '16px'
                }}
              >
                {activeMissionCurriculum.bonusLap2.iDo.formula}
              </div>
            )}

            <button
              className="btn btn-primary"
              onClick={() => {
                sounds.playTap();
                setBonusLap2WeDoIndex(0);
                setInteractiveSelectedAnswer(null);
                setInteractiveFeedback(null);
                setScreen('bonus_lap_2_we_do');
                window.scrollTo(0, 0);
              }}
            >
              [ I UNDERSTAND • PRACTICE TOGETHER ]
            </button>
          </div>
        </div>
      )}

      {/* SCREEN: BONUS LAP 2 WE DO */}
      {screen === 'bonus_lap_2_we_do' && activeMissionCurriculum?.bonusLap2 && (() => {
        const challenges = activeMissionCurriculum.bonusLap2.weDo.challenges;
        const currentChallenge = challenges[bonusLap2WeDoIndex] || challenges[0];
        return (
          <div className="screen">
            {renderSessionHeader()}
            {renderRelayRolesBar(currentGroup.members, 10 + bonusLap2WeDoIndex + 1)}
            <div className="instruction-stage-beads">
              <span className="stage-bead">BONUS 2: I DO ➔</span>
              <span className="stage-bead active">BONUS 2: WE DO ➔</span>
              <span className="stage-bead">BONUS 2: YOU DO 🏁</span>
            </div>

            <div className="coach-dash-card">
              <div className="coach-header">
                <div className="coach-avatar-badge">🏃</div>
                <div>
                  <strong style={{ fontSize: '16px', fontFamily: 'Baloo 2' }}>Coach Dash</strong>
                  <div style={{ fontSize: '11px', opacity: 0.7 }}>BONUS LAP 2 WE DO PRACTICE</div>
                </div>
              </div>
              <div className="coach-dialogue">
                &ldquo;{activeMissionCurriculum.bonusLap2.weDo.coachMessage}&rdquo;
              </div>
            </div>

            <div className="item-card">
              <div className="item-eyebrow">
                {currentChallenge.title} ({bonusLap2WeDoIndex + 1} of {challenges.length})
              </div>
              <div style={{ fontSize: '16px', fontWeight: 800, marginBottom: '14px' }}>
                {currentChallenge.prompt}
              </div>

              <div className="options-grid">
                {currentChallenge.options.map((opt, i) => {
                  const isSelected = interactiveSelectedAnswer === i;
                  const isCorrect = i === currentChallenge.correct;
                  let extra = '';
                  if (interactiveSelectedAnswer !== null) {
                    extra = isCorrect ? 'correct' : isSelected ? 'wrong' : '';
                  }
                  return (
                    <button
                      key={i}
                      className={`option-btn ${extra}`}
                      disabled={interactiveSelectedAnswer !== null}
                      onClick={() => {
                        sounds.playTap();
                        setInteractiveSelectedAnswer(i);
                        if (i === currentChallenge.correct) {
                          sounds.playCorrect();
                          setInteractiveFeedback({ isCorrect: true, message: currentChallenge.explanation });
                        } else {
                          sounds.playWrong();
                          setInteractiveFeedback({
                            isCorrect: false,
                            message: `Close! ${currentChallenge.explanation}`
                          });
                        }
                      }}
                    >
                      <span className="opt-letter">{letters[i]}</span>
                      <span>{opt}</span>
                    </button>
                  );
                })}
              </div>

              {interactiveFeedback && (
                <div
                  style={{
                    background: interactiveFeedback.isCorrect ? '#E4F7EC' : '#FCE7E4',
                    border: `2px solid ${interactiveFeedback.isCorrect ? 'var(--track)' : 'var(--danger)'}`,
                    borderRadius: '12px',
                    padding: '10px 14px',
                    marginTop: '14px',
                    fontSize: '13px',
                    fontWeight: 700
                  }}
                >
                  {interactiveFeedback.message}
                </div>
              )}

              {interactiveSelectedAnswer !== null && (
                <button
                  className="btn btn-primary"
                  style={{ marginTop: '16px' }}
                  onClick={() => {
                    sounds.playTap();
                    setInteractiveSelectedAnswer(null);
                    setInteractiveFeedback(null);
                    if (bonusLap2WeDoIndex + 1 < challenges.length) {
                      setBonusLap2WeDoIndex(bonusLap2WeDoIndex + 1);
                      window.scrollTo(0, 0);
                    } else {
                      setScreen('bonus_lap_2_you_do_intro');
                      window.scrollTo(0, 0);
                    }
                  }}
                >
                  {bonusLap2WeDoIndex + 1 < challenges.length
                    ? '[ NEXT CHALLENGE ]'
                    : '[ READY FOR BONUS YOU DO ]'}
                </button>
              )}
            </div>
          </div>
        );
      })()}

      {/* SCREEN: BONUS LAP 2 YOU DO INTRO */}
      {screen === 'bonus_lap_2_you_do_intro' && activeMissionCurriculum?.bonusLap2 && (
        <div className="screen">
          {renderSessionHeader()}
          <div className="instruction-stage-beads">
            <span className="stage-bead">BONUS 2: I DO ➔</span>
            <span className="stage-bead">BONUS 2: WE DO ➔</span>
            <span className="stage-bead active">BONUS 2: YOU DO 🏁</span>
          </div>

          <div className="coach-dash-card">
            <div className="coach-header">
              <div className="coach-avatar-badge">🏃</div>
              <div>
                <strong style={{ fontSize: '16px', fontFamily: 'Baloo 2' }}>Coach Dash</strong>
                <div style={{ fontSize: '11px', opacity: 0.7 }}>CHAMPION FINAL LAP &mdash; YOUR TURN!</div>
              </div>
            </div>
            <div className="coach-dialogue">
              &ldquo;{activeMissionCurriculum.bonusLap2.youDo.coachMessage}&rdquo;
            </div>
          </div>

          <div className="item-card" style={{ textAlign: 'center', padding: '24px 20px' }}>
            <h2 style={{ fontSize: '20px', marginBottom: '8px' }}>Bonus Lap 2 Final Stretch!</h2>
            <p style={{ fontSize: '13px', opacity: 0.8, lineHeight: 1.6, marginBottom: '20px' }}>
              Final 5 questions of this mission! Rotate roles, think together, and cross the finish line!
            </p>
            <button
              className="btn btn-primary"
              onClick={() => {
                sounds.playTap();
                setScreen('turn');
                window.scrollTo(0, 0);
              }}
            >
              [ START BONUS LAP 2 ]
            </button>
          </div>
        </div>
      )}

      {/* SCREEN: TURN / BATON PASS */}
      {screen === 'turn' && session && (() => {
        const rotated = getRotatedRoles(currentGroup.members, session.itemIndex);
        const tapRunner = rotated.find((r) => r.roleInfo.role === 'RUNNER') || rotated[0];
        return (
          <div className="screen" id="screen-turn">
            {renderSessionHeader()}
            {renderRelayRolesBar(currentGroup.members, session.itemIndex)}
            <div className="turn-wrap">
              <Mascot type="ready" />
              <div className="turn-hint">Current Baton Holder:</div>
              <div
                className="player-avatar"
                style={{ background: GROUP_COLORS[session.groupIndex % GROUP_COLORS.length] }}
              >
                {tapRunner.member.trim().charAt(0).toUpperCase() || 'R'}
              </div>
              <div className="player-name display">{tapRunner.member}</div>
              <div className="turn-hint" style={{ marginBottom: '12px' }}>
                Role: <b>🏃 RUNNER (Taps &amp; Submits Answer)</b> &bull; Item {session.itemIndex + 1} of {session.itemOrder.length}
              </div>
              <button className="btn btn-baton" onClick={handleStartItemTurn}>
                I&apos;m ready! Hand me the baton ➔
              </button>
            </div>
          </div>
        );
      })()}

      {/* SCREEN: ITEM */}
      {screen === 'item' && session && (() => {
        const rotated = getRotatedRoles(currentGroup.members, session.itemIndex);
        const tapRunner = rotated.find((r) => r.roleInfo.role === 'RUNNER') || rotated[0];
        const isMission = activePhase.key.startsWith('session');
        const currentLapTitle = isMission
          ? session.itemIndex < 5
            ? 'Main Lap 1'
            : session.itemIndex < 10
            ? 'Bonus Lap 1'
            : 'Bonus Lap 2'
          : '';
        const questionInLap = isMission ? (session.itemIndex % 5) + 1 : session.itemIndex + 1;
        return (
          <div className="screen" id="screen-item">
            {renderSessionHeader()}
            {renderRelayRolesBar(currentGroup.members, session.itemIndex)}
            <div className="item-topline">
              <div
                className="pill"
                style={{ color: GROUP_COLORS[session.groupIndex % GROUP_COLORS.length] }}
              >
                🏃 {tapRunner.member} (Runner)
              </div>
              <div className="pill">
                {isMission
                  ? `${currentLapTitle} • Q${questionInLap}/5 (Item ${session.itemIndex + 1}/${session.itemOrder.length})`
                  : `Item ${session.itemIndex + 1} / ${session.itemOrder.length}`}
              </div>
            </div>

            <div className="progress-track">
              <div
                className="progress-fill"
                style={{
                  width: `${Math.round((session.itemIndex / session.itemOrder.length) * 100)}%`,
                  background: GROUP_COLORS[session.groupIndex % GROUP_COLORS.length]
                }}
              />
            </div>

            <div className="item-card">
              <div className="item-eyebrow">
                {isMission ? `${currentLapTitle.toUpperCase()} • ${activePhase.eyebrow}` : activePhase.eyebrow}
              </div>
              <div
                className="item-prompt"
                dangerouslySetInnerHTML={{ __html: currentItemPromptHtml }}
              />
            </div>

            <div className="options-grid">
              {currentItem.o.map((opt, oi) => {
                const isSelected = selectedOptionIndex === oi;
                const isCorrect = oi === currentItem.c;
                let extraClass = '';
                if (selectedOptionIndex !== null) {
                  if (activePhase.showFeedback) {
                    if (isCorrect) extraClass = 'correct';
                    else if (isSelected) extraClass = 'wrong';
                  } else {
                    if (isSelected) extraClass = 'selected';
                  }
                }
                return (
                  <button
                    key={oi}
                    disabled={selectedOptionIndex !== null}
                    className={`option-btn ${extraClass}`}
                    onClick={() => handleSelectOption(oi, currentItem)}
                  >
                    <span className="opt-letter">{letters[oi]}</span>
                    <span>{opt}</span>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* FEEDBACK OVERLAY */}
      {feedbackOverlayShow && (
        <div className="feedback-overlay show" id="feedback-overlay">
          <div className={`feedback-card ${feedbackCardType}`}>
            <div className="feedback-title">{feedbackTitle}</div>
            <div className="feedback-sub">{feedbackSub}</div>
            <button className="btn btn-primary" onClick={handleNextTurnOrItem}>
              Next ➔
            </button>
          </div>
        </div>
      )}

      {/* SCREEN: MISSION RESULT & BADGE */}
      {screen === 'mission_result' && (
        <div className="screen">
          {renderSessionHeader()}
          <div className="end-wrap">
            <Mascot type="cheer" isBig />
            <div className="end-badge">{endBadge}</div>
            <div className="end-title display">{endTitle}</div>
            <div className="end-msg">{endMsg}</div>
            <div
              style={{
                background: '#FFF9E6',
                border: '2px solid #FCD34D',
                borderRadius: '16px',
                padding: '16px',
                marginBottom: '20px'
              }}
            >
              <div style={{ fontSize: '36px', marginBottom: '4px' }}>
                {activePhase.badgeIcon || '🥇'}
              </div>
              <strong style={{ fontSize: '16px', fontFamily: 'Baloo 2', color: '#B45309' }}>
                BADGE UNLOCKED: {activePhase.badgeName || 'RELAY CHAMPION'}
              </strong>
            </div>
            <button
              className="btn btn-primary"
              onClick={() => {
                sounds.playTap();
                setScreen('map');
                window.scrollTo(0, 0);
              }}
            >
              Back to Race Map
            </button>
          </div>
        </div>
      )}

      {/* SCREEN: POSTTEST WELCOME */}
      {screen === 'posttest_welcome' && (
        <div className="screen">
          {renderSessionHeader()}
          <div className="coach-dash-card">
            <div className="coach-header">
              <div className="coach-avatar-badge">🏃</div>
              <div>
                <strong style={{ fontSize: '16px', fontFamily: 'Baloo 2' }}>Coach Dash</strong>
                <div style={{ fontSize: '11px', opacity: 0.7 }}>POSTTEST INTRO</div>
              </div>
            </div>
            <div className="coach-dialogue">
              &ldquo;🏁 FINAL STRETCH! You&apos;ve completed all 4 missions! Now let&apos;s see how much you&apos;ve improved since the Pretest on this 12-item Summative Test.&rdquo;
            </div>
          </div>

          <div className="item-card" style={{ textAlign: 'center', padding: '24px 20px' }}>
            <div style={{ fontSize: '42px', marginBottom: '8px' }}>🏁</div>
            <h2 style={{ fontSize: '20px', marginBottom: '8px' }}>FINISH-LINE POSTTEST</h2>
            <p style={{ fontSize: '13px', opacity: 0.8, lineHeight: 1.6, marginBottom: '20px' }}>
              Parallel in format and difficulty to the Pretest &mdash; 12 items under standard conditions (no timer, individual seatwork), covering both competencies.
            </p>
            <button
              className="btn btn-primary"
              onClick={() => {
                sounds.playTap();
                setScreen('turn');
                window.scrollTo(0, 0);
              }}
            >
              [ START POSTTEST ]
            </button>
          </div>
        </div>
      )}

      {/* SCREEN: POSTTEST RESULTS */}
      {screen === 'posttest_results' && (() => {
        const teamName = session ? appState.groups[session.groupIndex].name : 'Your Team';
        const teamLogs = logData.filter((l) => l.team === teamName);
        const pretestLogs = teamLogs.filter((l) => l.phase === 'pretest');
        const posttestLogs = teamLogs.filter((l) => l.phase === 'posttest');
        const preScore = pretestLogs.filter((l) => l.correct).length;
        const preTotal = pretestLogs.length || 12;
        const prePct = Math.round((preScore / preTotal) * 100);
        const postScore = posttestLogs.filter((l) => l.correct).length;
        const postTotal = posttestLogs.length || 12;
        const postPct = Math.round((postScore / postTotal) * 100);
        const meanGain = postPct - prePct;
        const preRating = getDepEdRating(prePct);
        const postRating = getDepEdRating(postPct);
        return (
          <div className="screen">
            {renderSessionHeader()}
            <div className="end-wrap" style={{ paddingTop: '10px' }}>
              <Mascot type="cheer" isBig />
              <div className="end-badge">🏆</div>
              <div className="end-title display">PRETEST VS POSTTEST RESULTS</div>
              <div className="coach-dash-card" style={{ textAlign: 'left', marginTop: '12px' }}>
                <div className="coach-header">
                  <div className="coach-avatar-badge">🏃</div>
                  <div>
                    <strong style={{ fontSize: '16px', fontFamily: 'Baloo 2' }}>Coach Dash</strong>
                  </div>
                </div>
                <div className="coach-dialogue">
                  &ldquo;Let&apos;s see your results! Here&apos;s how you did across all 12 items:&rdquo;
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', margin: '16px 0' }}>
                <div style={{ background: 'var(--cream)', border: '2px solid var(--line)', borderRadius: '14px', padding: '14px', textAlign: 'center' }}>
                  <div style={{ fontSize: '11px', fontWeight: 800, opacity: 0.6 }}>PRETEST (BASELINE)</div>
                  <div style={{ fontSize: '28px', fontWeight: 800, fontFamily: 'Baloo 2', color: 'var(--ink)' }}>
                    {prePct}%
                  </div>
                  <div style={{ fontSize: '12px', opacity: 0.8, marginBottom: '6px' }}>
                    {preScore} / {preTotal} correct
                  </div>
                  <span
                    className="deped-badge"
                    style={{ background: preRating.bg, color: preRating.color }}
                  >
                    {preRating.label.split(' ')[0]}
                  </span>
                </div>
                <div style={{ background: '#E4F7EC', border: '2px solid var(--track)', borderRadius: '14px', padding: '14px', textAlign: 'center' }}>
                  <div style={{ fontSize: '11px', fontWeight: 800, color: 'var(--track-dark)' }}>POSTTEST (SUMMATIVE)</div>
                  <div style={{ fontSize: '28px', fontWeight: 800, fontFamily: 'Baloo 2', color: 'var(--track-dark)' }}>
                    {postPct}%
                  </div>
                  <div style={{ fontSize: '12px', opacity: 0.8, marginBottom: '6px' }}>
                    {postScore} / {postTotal} correct
                  </div>
                  <span
                    className="deped-badge"
                    style={{ background: postRating.bg, color: postRating.color }}
                  >
                    {postRating.label.split(' ')[0]}
                  </span>
                </div>
              </div>

              <div
                style={{
                  background: meanGain >= 0 ? '#E4F7EC' : '#FFF3CD',
                  border: `2px solid ${meanGain >= 0 ? 'var(--track)' : '#D97706'}`,
                  borderRadius: '14px',
                  padding: '12px',
                  marginBottom: '20px'
                }}
              >
                <div style={{ fontSize: '12px', fontWeight: 800, opacity: 0.8 }}>MEAN GAIN (POSTTEST % - PRETEST %)</div>
                <div style={{ fontSize: '26px', fontWeight: 800, fontFamily: 'Baloo 2', color: meanGain >= 0 ? 'var(--track-dark)' : '#B45309' }}>
                  {meanGain >= 0 ? `+${meanGain}% Improvement! 🚀` : `${meanGain}%`}
                </div>
              </div>

              <button
                className="btn btn-primary"
                onClick={() => {
                  sounds.playTap();
                  setScreen('survey');
                  window.scrollTo(0, 0);
                }}
              >
                [ CONTINUE TO FEEDBACK SURVEY ]
              </button>
            </div>
          </div>
        );
      })()}

      {/* SCREEN: FEEDBACK SURVEY */}
      {screen === 'survey' && (
        <div className="screen">
          {renderSessionHeader()}
          <div className="coach-dash-card">
            <div className="coach-header">
              <div className="coach-avatar-badge">🏃</div>
              <div>
                <strong style={{ fontSize: '16px', fontFamily: 'Baloo 2' }}>Coach Dash</strong>
                <div style={{ fontSize: '11px', opacity: 0.7 }}>FEEDBACK SURVEY</div>
              </div>
            </div>
            <div className="coach-dialogue">
              &ldquo;One last thing, Relay Runners! Tell us what you think of the GGR website.&rdquo;
            </div>
          </div>

          <div className="item-card">
            <div style={{ fontSize: '12px', fontWeight: 800, opacity: 0.7, marginBottom: '14px' }}>
              Rate 1 (Strongly Disagree) to 5 (Strongly Agree):
            </div>

            <div style={{ marginBottom: '16px' }}>
              <div style={{ fontSize: '13.5px', fontWeight: 800, marginBottom: '4px' }}>
                1. I enjoyed doing the Gamified Grammar Relay activities.
              </div>
              <div className="rating-group">
                {[1, 2, 3, 4, 5].map((val) => (
                  <button
                    key={val}
                    type="button"
                    className={`rating-btn ${surveyQ1 === val ? 'selected' : ''}`}
                    onClick={() => {
                      sounds.playTap();
                      setSurveyQ1(val);
                    }}
                  >
                    {val}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ marginBottom: '16px' }}>
              <div style={{ fontSize: '13.5px', fontWeight: 800, marginBottom: '4px' }}>
                2. The GGR website helped me understand grammar better than usual worksheets.
              </div>
              <div className="rating-group">
                {[1, 2, 3, 4, 5].map((val) => (
                  <button
                    key={val}
                    type="button"
                    className={`rating-btn ${surveyQ2 === val ? 'selected' : ''}`}
                    onClick={() => {
                      sounds.playTap();
                      setSurveyQ2(val);
                    }}
                  >
                    {val}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ marginBottom: '16px' }}>
              <div style={{ fontSize: '13.5px', fontWeight: 800, marginBottom: '4px' }}>
                3. I want to use the GGR website again in future lessons.
              </div>
              <div className="rating-group">
                {[1, 2, 3, 4, 5].map((val) => (
                  <button
                    key={val}
                    type="button"
                    className={`rating-btn ${surveyQ3 === val ? 'selected' : ''}`}
                    onClick={() => {
                      sounds.playTap();
                      setSurveyQ3(val);
                    }}
                  >
                    {val}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ marginBottom: '18px' }}>
              <label style={{ fontSize: '12px', fontWeight: 800, display: 'block', marginBottom: '4px' }}>
                Comments / Feedback (Optional):
              </label>
              <textarea
                className="text-input"
                style={{ height: '60px', resize: 'none' }}
                placeholder="What did your team enjoy most about the relay?"
                value={surveyComment}
                onChange={(e) => setSurveyComment(e.target.value)}
              />
            </div>

            <button className="btn btn-primary" onClick={handleSubmitSurvey}>
              [ SUBMIT FEEDBACK ]
            </button>
          </div>
        </div>
      )}

      {/* SCREEN: THANK YOU */}
      {screen === 'thank_you' && (
        <div className="screen">
          {renderSessionHeader()}
          <div className="end-wrap">
            <Mascot type="cheer" isBig />
            <div className="end-badge">🎉</div>
            <div className="end-title display">SALAMAT! THANK YOU!</div>
            <div className="coach-dash-card" style={{ textAlign: 'left', marginTop: '12px' }}>
              <div className="coach-header">
                <div className="coach-avatar-badge">🏃</div>
                <div>
                  <strong style={{ fontSize: '16px', fontFamily: 'Baloo 2' }}>Coach Dash</strong>
                </div>
              </div>
              <div className="coach-dialogue">
                &ldquo;You&apos;ve completed the full Gamified Grammar Relay cycle: Pretest ➔ 4 Missions ➔ Posttest ➔ Feedback. Great job, Champion!&rdquo;
              </div>
            </div>
            <button
              className="btn btn-primary"
              style={{ marginTop: '16px' }}
              onClick={() => {
                sounds.playTap();
                setScreen('map');
                window.scrollTo(0, 0);
              }}
            >
              Back to Race Map
            </button>
          </div>
        </div>
      )}

      {/* Confetti particles */}
      {confetti.map((c) => (
        <div
          key={c.id}
          className="confetti-piece"
          style={{
            left: `${c.left}vw`,
            background: c.background,
            animationDuration: `${c.duration}s`,
            animationDelay: `${c.delay}s`
          }}
        />
      ))}

      {/* Admin gear button */}
      {(screen === 'map' || screen === 'team_login') && (
        <button
          className="icon-btn admin-gear"
          id="admin-gear-btn"
          onClick={() => {
            sounds.playTap();
            setPinInput('');
            setPinError(false);
            setIsPinModalOpen(true);
            setTimeout(() => pinInputRef.current?.focus(), 150);
          }}
          aria-label="Teacher settings and activity manager"
          title="Teacher &amp; Researcher Panel"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
            <path d="M12 15a3 3 0 100-6 3 3 0 000 6z" stroke="currentColor" strokeWidth="2" />
            <path
              d="M19.4 13a1.6 1.6 0 00.32 1.77l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.6 1.6 0 00-1.77-.32 1.6 1.6 0 00-1 1.47V19a2 2 0 11-4 0v-.09a1.6 1.6 0 00-1.47 1.6 1.6 0 00-1.77.32l-.06.06a2 2 0 112.83-2.83l.06.06A1.6 1.6 0 007.18 2.6a1.6 1.6 0 001-1.47V1a2 2 0 114 0v.09a1.6 1.6 0 001 1.47 1.6 1.6 0 001.77-.32l.06-.06a2 2 0 112.83 2.83l-.06.06A1.6 1.6 0 0019.4 7a1.6 1.6 0 001.47 1H21a2 2 0 110 4h-.09a1.6 1.6 0 00-1.47 1z"
              stroke="currentColor"
              strokeWidth="1.8"
            />
          </svg>
        </button>
      )}

      {/* LOCKED STATION COACH DASH MODAL */}
      {lockedModalInfo && (
        <div className="modal-backdrop show">
          <div className="modal-box" style={{ textAlign: 'center', padding: '26px 20px', maxWidth: '440px' }}>
            <div style={{ fontSize: '48px', marginBottom: '8px' }}>
              {lockedModalInfo.icon}
            </div>
            <h2 style={{ fontSize: '20px', marginBottom: '6px' }}>
              {lockedModalInfo.title}
            </h2>
            <div className="coach-dash-card" style={{ textAlign: 'left', marginTop: '14px', marginBottom: '16px' }}>
              <div className="coach-header">
                <div className="coach-avatar-badge">🏃</div>
                <div>
                  <strong style={{ fontSize: '15px', fontFamily: 'Baloo 2' }}>Coach Dash</strong>
                  <div style={{ fontSize: '11px', opacity: 0.7 }}>Station Access</div>
                </div>
              </div>
              <div className="coach-dialogue">
                &ldquo;{lockedModalInfo.message}&rdquo;
              </div>
            </div>
            <button
              className="btn btn-primary"
              onClick={() => {
                sounds.playTap();
                setLockedModalInfo(null);
              }}
            >
              Got it, Coach!
            </button>
          </div>
        </div>
      )}

      {/* PIN MODAL */}
      {isPinModalOpen && (
        <div className="modal-backdrop show">
          <div className="modal-box">
            <h2>Teacher / Researcher Area</h2>
            <div className="modal-sub">Enter the PIN to manage phases, rosters, CSV sync, and analytics (Default: 1234)</div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleCheckPin();
              }}
            >
              <input
                ref={pinInputRef}
                className="pin-input"
                type="password"
                inputMode="numeric"
                maxLength={6}
                placeholder="••••"
                value={pinInput}
                onChange={(e) => {
                  setPinInput(e.target.value);
                  setPinError(false);
                }}
              />
              <button type="submit" className="btn btn-primary">
                Unlock
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                style={{ marginTop: '8px' }}
                onClick={() => {
                  sounds.playTap();
                  setIsPinModalOpen(false);
                }}
              >
                Cancel
              </button>
              {pinError && (
                <div
                  style={{
                    color: 'var(--danger)',
                    fontWeight: 800,
                    fontSize: '13px',
                    textAlign: 'center',
                    marginTop: '10px'
                  }}
                >
                  Wrong PIN, try again.
                </div>
              )}
            </form>
          </div>
        </div>
      )}

      {/* TEACHER & RESEARCHER PANEL */}
      {isAdminModalOpen && (
        <TeacherPanel
          appState={appState}
          logData={logData}
          setAppState={setAppState}
          setLogData={setLogData}
          currentTheme={currentTheme}
          setCurrentTheme={setCurrentTheme}
          themes={THEMES}
          adminNotification={adminNotification}
          setAdminNotification={setAdminNotification}
          onOpenCsvSync={() => setIsCsvSyncModalOpen(true)}
          onSeedSampleData={handleSeedSampleData}
          onShowStandingsModal={() => {
            fetchServerSync();
            setShowStandingsModal(true);
          }}
          onClose={() => setIsAdminModalOpen(false)}
        />
      )}

      {/* CSV SYNC MODAL */}
      {isCsvSyncModalOpen && (
        <CsvSyncModal
          appState={appState}
          logData={logData}
          onSyncComplete={(newLogs, newCompleted, message) => {
            setLogData(newLogs);
            setAppState((prev) => ({
              ...prev,
              completedToday: newCompleted
            }));
            setAdminNotification(message);
            fetch('/api/sync/bulk', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ logs: newLogs, completedToday: newCompleted })
            }).catch(() => {});
            setTimeout(() => setAdminNotification(null), 4000);
          }}
          onClose={() => setIsCsvSyncModalOpen(false)}
        />
      )}
    </>
  );
}
