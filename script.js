// 11주차 강의자료: querySelector -> addEventListener -> classList.toggle
import { firebaseConfig, ADMIN_UID } from './firebase-config.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import { getDatabase, ref, onValue, push, set, update, remove } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-database.js';

/* ---------- 햄버거 메뉴 ---------- */
const hamburger = document.querySelector('#hamburger');
const menu = document.querySelector('.menu');

hamburger.addEventListener('click', () => {
  menu.classList.toggle('open');
  hamburger.setAttribute('aria-expanded', menu.classList.contains('open'));
});

/* ---------- 로그인 창 ---------- */
const loginDialog = document.querySelector('#loginDialog');
const authOpen = document.querySelector('#authOpen');
const logoutBtn = document.querySelector('#logoutBtn');
const loginStatus = document.querySelector('#loginStatus');

authOpen.addEventListener('click', () => {
  menu.classList.remove('open');
  hamburger.setAttribute('aria-expanded', 'false');
  loginDialog.showModal();
});

document.querySelector('#loginClose').addEventListener('click', () => loginDialog.close());

/* ---------- 공통 변수 ---------- */
const configured = Boolean(
  firebaseConfig.apiKey &&
  firebaseConfig.databaseURL &&
  firebaseConfig.projectId &&
  firebaseConfig.appId &&
  ADMIN_UID
);

let auth;
let database;
let isAdmin = false;

const region = document.body.dataset.region;
const adminTools = document.querySelector('#adminTools');
const dataStatus = document.querySelector('#dataStatus');
const placesList = document.querySelector('#placesList');
const placeCount = document.querySelector('#placeCount');
const placeForm = document.querySelector('#placeForm');

let entries = {};
let editingId = null;
let previousPhoto = '';

/* ---------- 관리자 화면 ---------- */
function updateAdminUI(user) {
  isAdmin = Boolean(user && user.uid === ADMIN_UID);
  authOpen.hidden = Boolean(user);
  logoutBtn.hidden = !user;

  if (adminTools) adminTools.hidden = !isAdmin;
  if (user && !isAdmin) loginStatus.textContent = '이 계정은 관리자 권한이 없습니다.';

  renderPlaces();
}

/* ---------- 장소 카드 그리기 ---------- */
function makeText(tag, className, content) {
  const el = document.createElement(tag);
  el.className = className;
  el.textContent = content;
  return el;
}

function renderPlaces() {
  if (!placesList) return;

  placesList.replaceChildren();

  const sorted = Object.entries(entries).sort((a, b) => (b[1].createdAt || 0) - (a[1].createdAt || 0));
  placeCount.textContent = `${sorted.length}개의 보물`;

  if (!sorted.length) {
    placesList.append(makeText('p', 'empty', '아직 기록된 장소가 없어요. 첫 번째 보물을 기다리는 중! 🗺️'));
    return;
  }

  for (const [id, item] of sorted) {
    const card = makeText('article', 'place-card', '');

    if (item.photo) {
      const img = document.createElement('img');
      img.className = 'photo';
      img.src = item.photo;
      img.alt = `${item.name || '장소'} 사진`;
      img.loading = 'lazy';
      card.append(img);
    } else {
      card.append(makeText('div', 'photo-placeholder', '📷'));
    }

    const body = makeText('div', 'card-body', '');
    body.append(
      makeText('h3', '', item.name || '이름 없는 장소'),
      makeText('p', 'address', item.address || ''),
      makeText('p', 'review', item.review || '')
    );

    if (isAdmin) {
      const expand = makeText('button', 'card-expand', '⚙️ 카드 관리 메뉴 열기');
      expand.type = 'button';
      expand.setAttribute('aria-expanded', 'false');

      const controls = makeText('div', 'card-controls', '');
      controls.hidden = true;

      const edit = makeText('button', 'secondary', '수정');
      edit.type = 'button';

      const del = makeText('button', 'secondary', '삭제');
      del.type = 'button';

      expand.addEventListener('click', () => {
        controls.hidden = !controls.hidden;
        expand.setAttribute('aria-expanded', String(!controls.hidden));
      });

      edit.addEventListener('click', () => editPlace(id, item));

      del.addEventListener('click', async () => {
        if (!confirm(`“${item.name}” 기록을 삭제할까요?`)) return;
        try {
          await remove(ref(database, `places/${region}/${id}`));
        } catch (e) {
          alert('삭제 실패: ' + e.message);
        }
      });

      controls.append(edit, del);
      body.append(expand, controls);
    }

    card.append(body);
    placesList.append(card);
  }
}

/* ---------- 수정 / 폼 초기화 ---------- */
function editPlace(id, item) {
  editingId = id;
  previousPhoto = item.photo || '';

  document.querySelector('#placeName').value = item.name || '';
  document.querySelector('#placeAddress').value = item.address || '';
  document.querySelector('#placeReview').value = item.review || '';
  document.querySelector('#placePhoto').value = '';
  document.querySelector('#formTitle').textContent = '보물 기록 수정하기';

  placeForm.hidden = false;
  document.querySelector('#formToggle').setAttribute('aria-expanded', 'true');
  placeForm.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function resetForm() {
  editingId = null;
  previousPhoto = '';

  placeForm.reset();
  placeForm.hidden = true;

  document.querySelector('#formTitle').textContent = '새로운 장소 기록하기';
  document.querySelector('#formToggle').setAttribute('aria-expanded', 'false');
  document.querySelector('#formStatus').textContent = '';
}

/* ---------- 장소 등록 폼 ---------- */
if (placeForm) {
  document.querySelector('#formToggle').addEventListener('click', () => {
    if (!isAdmin) return;
    placeForm.hidden = !placeForm.hidden;
    document.querySelector('#formToggle').setAttribute('aria-expanded', String(!placeForm.hidden));
  });

  document.querySelector('#cancelBtn').addEventListener('click', resetForm);

  placeForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!isAdmin || !database) return;

    const status = document.querySelector('#formStatus');
    const save = document.querySelector('#saveBtn');
    save.disabled = true;
    status.textContent = '보물을 저장하는 중...';

    try {
      const photoFile = document.querySelector('#placePhoto').files[0];
      const photo = photoFile ? await compressPhoto(photoFile) : previousPhoto;

      const item = {
        name: document.querySelector('#placeName').value.trim(),
        address: document.querySelector('#placeAddress').value.trim(),
        review: document.querySelector('#placeReview').value.trim(),
        photo,
        createdAt: editingId ? (entries[editingId]?.createdAt || Date.now()) : Date.now()
      };

      if (!item.name || !item.address || !item.review) throw new Error('모든 내용을 입력해 주세요.');

      if (editingId) await update(ref(database, `places/${region}/${editingId}`), item);
      else await set(push(ref(database, `places/${region}`)), item);

      resetForm();
    } catch (e) {
      status.textContent = '저장 실패: ' + e.message;
    } finally {
      save.disabled = false;
    }
  });
}

/* ---------- 사진 압축 ---------- */
// 강의자료 외 추가 기능: 사진을 작게 압축해 Realtime Database에 저장.
// 별도 Storage 요금제 설정 없이 시험할 수 있지만 사진이 많으면 DB 사용량이 늘어납니다.
function compressPhoto(file) {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      reject(new Error('이미지 파일만 선택할 수 있어요.'));
      return;
    }

    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      try {
        const max = 640;
        const scale = Math.min(1, max / Math.max(img.width, img.height));

        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);

        const result = canvas.toDataURL('image/jpeg', 0.65);
        URL.revokeObjectURL(url);

        if (result.length > 170000) reject(new Error('사진이 너무 커요. 더 작은 사진을 선택해 주세요.'));
        else resolve(result);
      } catch (e) {
        URL.revokeObjectURL(url);
        reject(e);
      }
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('사진을 읽지 못했어요.'));
    };

    img.src = url;
  });
}

/* ---------- Firebase 연결 ---------- */
if (!configured) {
  loginStatus.textContent = 'Firebase 설정이 아직 연결되지 않았어요. README를 확인해 주세요.';
  if (dataStatus) dataStatus.textContent = '🔧 Firebase 연결 전입니다. README의 설정 방법을 따라 주세요.';
  renderPlaces();
} else {
  try {
    const app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    database = getDatabase(app);

    onAuthStateChanged(auth, updateAdminUI);

    if (region) {
      onValue(
        ref(database, `places/${region}`),
        (snapshot) => {
          entries = snapshot.val() || {};
          dataStatus.textContent = '';
          renderPlaces();
        },
        (error) => {
          dataStatus.textContent = '기록을 불러오지 못했어요: ' + error.message;
        }
      );
    }
  } catch (e) {
    if (dataStatus) dataStatus.textContent = 'Firebase 연결 오류: ' + e.message;
    loginStatus.textContent = e.message;
  }
}

/* ---------- 로그인 / 로그아웃 ---------- */
document.querySelector('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();

  if (!auth) {
    loginStatus.textContent = 'Firebase 설정을 먼저 완료해 주세요.';
    return;
  }

  try {
    const result = await signInWithEmailAndPassword(
      auth,
      document.querySelector('#loginEmail').value,
      document.querySelector('#loginPassword').value
    );

    if (result.user.uid !== ADMIN_UID) {
      await signOut(auth);
      throw new Error('관리자로 지정되지 않은 계정이에요.');
    }

    loginStatus.textContent = '';
    document.querySelector('#loginPassword').value = '';
    loginDialog.close();
  } catch (error) {
    loginStatus.textContent = '로그인 실패: ' + error.message;
  }
});

logoutBtn.addEventListener('click', async () => {
  if (auth) await signOut(auth);

  menu.classList.remove('open');
  hamburger.setAttribute('aria-expanded', 'false');

  if (placeForm) resetForm();
});
