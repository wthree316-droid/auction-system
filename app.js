// app.js - Final Version + IP Lock (1 IP = 1 User)

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore, collection, addDoc, getDocs, doc, getDoc, setDoc, updateDoc, query, orderBy, onSnapshot, limit, where } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

// ⚠️ Config (อย่าลืมใช้ของตัวเอง)
const firebaseConfig = {
    apiKey: "AIzaSyCQOSvE07bNi2WfCymRdOabDewgYRs4UM4",
    authDomain: "auction-system-e9801.firebaseapp.com",
    projectId: "auction-system-e9801",
    storageBucket: "auction-v2-img-999", 
    messagingSenderId: "1089558422014",
    appId: "1:1089558422014:web:4052e4b6e8f391c5a5a0af"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

// Variables
let currentUser = null;
let currentIp = "Unknown";
let isBanned = false;
let userProfileCache = {};
let allProducts = [];

let currentProductId = null;
let currentProductEndTime = null; 
let unsubscribeProduct = null;
let unsubscribeBids = null;

// ... (ส่วน Search, Dashboard, Logic อื่นๆ คงเดิม ไม่ต้องแก้) ...
// (ผมจะข้ามส่วนที่ไม่เกี่ยวข้องไป เพื่อเน้นจุดที่แก้ครับ)

const searchInput = document.getElementById('searchInput');
if(searchInput) {
    searchInput.addEventListener('input', (e) => {
        const keyword = e.target.value.toLowerCase();
        const filtered = allProducts.filter(p => p.title.toLowerCase().includes(keyword));
        renderProducts(filtered);
    });
}

function renderProducts(products) {
    const listContainer = document.getElementById('productList');
    if(!listContainer) return;
    listContainer.innerHTML = "";
    if(products.length === 0) {
        listContainer.innerHTML = "<p class='text-center text-secondary w-100 mt-5'>ไม่พบสินค้า</p>";
        return;
    }
    products.forEach(item => {
        const safeTitle = item.title.replace(/'/g, "\\'");
        const safeDesc = item.description ? item.description.replace(/'/g, "\\'").replace(/"/g, '&quot;') : "";
        const timerId = `timer-${item.id}`;
        const badgeId = `badge-${item.id}`;
        const endTime = item.end_time_ms || 0;
        let soldOverlay = item.status === 'sold' ? `<div class="position-absolute top-50 start-50 translate-middle bg-danger text-white px-3 py-1 fw-bold fs-4 rotate-n15 border border-2 border-white opacity-75" style="transform: translate(-50%, -50%) rotate(-15deg); z-index:10;">SOLD</div>` : "";
        
        const html = `
            <div class="col-6 col-md-4 col-lg-3">
                <div class="card h-100 cursor-pointer position-relative" onclick="openAuction('${item.id}', '${safeTitle}', '${item.current_price}', '${item.image_url}', \`${safeDesc}\`)" style="cursor: pointer;">
                    ${soldOverlay}
                    <div class="position-absolute top-0 end-0 p-2">
                        <span id="${badgeId}" class="badge bg-warning text-dark shadow"><i class="bi bi-clock"></i> <span id="${timerId}" class="card-timer" data-end-time="${endTime}">--:--</span></span>
                    </div>
                    <img src="${item.image_url}" class="card-img-top product-img-list" alt="${item.title}">
                    <div class="card-body p-2">
                        <h6 class="card-title text-truncate">${item.title}</h6>
                        <p class="card-text text-danger fw-bold">฿${item.current_price.toLocaleString()}</p>
                    </div>
                </div>
            </div>
        `;
        listContainer.innerHTML += html;
    });
}

// ... (ฟังก์ชัน Dashboard, OpenAuction, Bid, BuyNow คงเดิม) ...
// เพื่อความกระชับ ขออนุญาตไม่แปะซ้ำในส่วนที่ไม่แก้ครับ
// แต่ถ้าคุณต้องการไฟล์เต็มๆ บอกได้ครับ ผมจะ Gen ให้ใหม่หมด

window.openDashboardModal = async function() {
    new bootstrap.Modal(document.getElementById('dashboardModal')).show();
    if(!currentUser) return;
    // ... (Dashboard logic same as before) ...
    // โหลดสินค้าของฉัน
    const mySellingContainer = document.getElementById('mySellingList');
    mySellingContainer.innerHTML = "<p class='text-center w-100 small text-secondary'>กำลังโหลด...</p>";
    const myItems = allProducts.filter(p => p.seller_uid === currentUser.uid);
    mySellingContainer.innerHTML = "";
    if(myItems.length === 0) mySellingContainer.innerHTML = "<p class='text-center w-100 small text-secondary'>ไม่มีสินค้า</p>";
    myItems.forEach(item => {
        const statusBadge = item.status === 'sold' ? '<span class="badge bg-success">ขายแล้ว</span>' : '<span class="badge bg-primary">กำลังขาย</span>';
        mySellingContainer.innerHTML += `<div class="col-12 col-md-6"><div class="border border-secondary p-2 rounded bg-black d-flex gap-3 align-items-center"><img src="${item.image_url}" style="width:60px; height:60px; object-fit:cover" class="rounded"><div class="text-truncate small fw-bold">${item.title}<br><span class="text-warning">฿${item.current_price}</span> ${statusBadge}</div></div></div>`;
    });
    // โหลดที่กำลังประมูล
    const myBiddingContainer = document.getElementById('myBiddingList');
    myBiddingContainer.innerHTML = "<p class='text-center w-100 small text-secondary'>กำลังคำนวณลำดับ...</p>";
    // ... (Ranking Logic same as before) ...
}

async function loadProducts() {
    const listContainer = document.getElementById('productList');
    if(!listContainer) return;
    const q = query(collection(db, "auctions"), orderBy("created_at", "desc")); 
    onSnapshot(q, (snapshot) => {
        allProducts = [];
        snapshot.forEach((doc) => {
            const data = doc.data();
            data.id = doc.id;
            allProducts.push(data);
        });
        renderProducts(allProducts);
    });
}
loadProducts();

// ==========================================
// 🔥 แก้ไขจุดนี้: ระบบล็อก IP (User Auth)
// ==========================================
async function initSystem() {
    try {
        const res = await fetch('https://api.ipify.org?format=json');
        const data = await res.json();
        currentIp = data.ip;
    } catch (e) { }
    signInAnonymously(auth).catch((error) => console.error(error));
}
initSystem();

onAuthStateChanged(auth, async (user) => {
    if (user) {
        currentUser = user;
        const userRef = doc(db, "users", user.uid);
        
        // เช็คก่อนว่ามี User Profile ของ UID นี้หรือยัง
        const userSnap = await getDoc(userRef);

        if (userSnap.exists()) {
            // ถ้ามีอยู่แล้ว -> โหลดข้อมูลปกติ (Monitor Real-time)
            onSnapshot(userRef, (docSnap) => {
                if (docSnap.exists()) {
                    const data = docSnap.data();
                    setupUserProfile(data);
                }
            });
        } else {
            // ถ้าเป็น User ใหม่ (เพิ่งเข้าครั้งแรก หรือเคลียร์ Cache)
            // 🔥 ตรวจสอบก่อนว่า IP นี้มีคนใช้หรือยัง?
            const usersRef = collection(db, "users");
            const qIp = query(usersRef, where("ip_address", "==", currentIp));
            const ipSnap = await getDocs(qIp);

            if (!ipSnap.empty) {
                // ⛔ เจอ IP ซ้ำ!
                const existingUser = ipSnap.docs[0].data();
                alert(`⚠️ แจ้งเตือนระบบความปลอดภัย\n\nIP ของคุณ (${currentIp}) มีบัญชีอยู่แล้วชื่อ: "${existingUser.displayName}"\n\nระบบไม่อนุญาตให้สร้างบัญชีซ้ำ\nกรุณากดปุ่ม "ย้ายเครื่อง" แล้วกรอกชื่อเดิมเพื่อใช้งาน`);
                
                updateUIName("Guest (IP ซ้ำ)");
                // ไม่สร้างข้อมูลลง Database ทำให้สถานะเป็นแค่ Guest ที่ไม่มีสิทธิ์
                return;
            }

            // ✅ ถ้า IP ไม่ซ้ำ -> สร้าง User ใหม่ได้
            const defaultName = "User_" + user.uid.slice(0,4);
            const userData = { 
                displayName: defaultName, 
                uid: user.uid, 
                ip_address: currentIp, 
                created_at: new Date() 
            };
            
            await setDoc(userRef, userData);
            
            // เริ่ม Monitor หลังจากสร้างเสร็จ
            onSnapshot(userRef, (docSnap) => {
                if (docSnap.exists()) setupUserProfile(docSnap.data());
            });
        }
    }
});

// ฟังก์ชันช่วยจัดการ UI โปรไฟล์
function setupUserProfile(data) {
    userProfileCache = data;
    isBanned = data.is_banned;
    updateUIName(data.displayName);
    
    if(document.getElementById('profileSecretCode')) {
        document.getElementById('profileSecretCode').value = data.secret_code || "";
        document.getElementById('profileLine').value = data.line_id || "";
        document.getElementById('profilePhone').value = data.phone || "";
        document.getElementById('profileFb').value = data.facebook_link || "";
    }
    
    if(isBanned) document.body.innerHTML = "<div class='vh-100 d-flex justify-content-center align-items-center bg-black'><h1 class='text-danger'>🚫 BANNED</h1></div>";
}

function updateUIName(name) {
    const el = document.getElementById('navUsername');
    if(el) el.innerText = name;
}

// ... (Timer Logic, OpenAuction, PlaceBid, BuyNow, AddModal, ProfileModal, RecoverModal คงเดิม) ...
// Copy ฟังก์ชันพวกนั้นจากเวอร์ชันก่อนหน้ามาวางต่อท้ายตรงนี้ได้เลยครับ
// หรือถ้าต้องการไฟล์เต็ม 100% บอกได้ครับ เดี๋ยวผมรวมให้อีกรอบเพื่อความชัวร์

// ... (Timer Logic) ...
setInterval(() => {
    if (currentProductEndTime && document.getElementById('auctionModal').classList.contains('show')) {
        updateTimerUI(currentProductEndTime, 'modalTimer', 'modalTimerBadge', true);
    }
    document.querySelectorAll('.card-timer').forEach(el => {
        const endTime = Number(el.dataset.endTime);
        const badgeId = el.id.replace('timer-', 'badge-'); 
        updateTimerUI(endTime, el.id, badgeId, false);
    });
}, 1000);

function updateTimerUI(endTimeMs, textId, badgeId, isModal) {
    const now = new Date().getTime();
    const distance = endTimeMs - now;
    const textEl = document.getElementById(textId);
    const badgeEl = document.getElementById(badgeId);
    if (!textEl) return;
    if (distance < 0) {
        textEl.innerText = "ปิดประมูลแล้ว";
        if(badgeEl) badgeEl.className = "badge bg-secondary";
        if(isModal) {
            document.getElementById('bidControlSection').classList.add('d-none');
            document.getElementById('buyNowSection').classList.add('d-none');
            if(document.getElementById('soldBadge').classList.contains('d-none')) {
                document.getElementById('auctionEndedMsg').classList.remove('d-none');
            } else { document.getElementById('auctionEndedMsg').classList.add('d-none'); }
        }
    } else {
        const days = Math.floor(distance / (1000 * 60 * 60 * 24));
        const hours = Math.floor((distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const minutes = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((distance % (1000 * 60)) / 1000);
        let timeString = "";
        if(days > 0) timeString += `${days}วัน `;
        timeString += `${hours}ชม. ${minutes}น. ${seconds}วิ.`;
        textEl.innerText = timeString;
        if(distance < 5 * 60 * 1000 && badgeEl) {
            badgeEl.className = "badge bg-danger animate__animated animate__flash";
        }
    }
}

// ... (OpenAuction, Bid, BuyNow, AddForm, Profile, Recover Logic) ...
// เพื่อให้ไฟล์สมบูรณ์ ผมจะใส่ placeholder สำหรับฟังก์ชันที่เหลือที่เหมือนเดิมนะครับ
// (ในทางปฏิบัติคือก๊อปปี้ส่วนที่เหลือทั้งหมดจากไฟล์ app.js อันเก่ามาวางต่อได้เลย)

window.openAuction = function(id, title, price, img, desc) {
    currentProductId = id;
    document.getElementById('modalTitle').innerText = title;
    document.getElementById('modalImage').src = img;
    document.getElementById('modalDesc').innerText = desc;
    document.getElementById('bidInput').value = "";
    document.getElementById('bidHistoryList').innerHTML = "<div class='text-center small mt-4'><div class='spinner-border spinner-border-sm'></div> กำลังโหลด...</div>";
    document.getElementById('bidControlSection').classList.remove('d-none');
    document.getElementById('auctionEndedMsg').classList.add('d-none');
    document.getElementById('soldMsg').classList.add('d-none');
    document.getElementById('soldBadge').classList.add('d-none');
    document.getElementById('buyNowSection').classList.add('d-none');
    document.getElementById('modalLine').innerText = "-";
    document.getElementById('modalPhone').innerText = "-";
    document.getElementById('modalSellerName').innerText = "...";
    document.getElementById('modalFacebookLink').classList.add('d-none');
    document.getElementById('modalEditBtn').classList.add('d-none');

    if (unsubscribeProduct) unsubscribeProduct();
    if (unsubscribeBids) unsubscribeBids();

    unsubscribeProduct = onSnapshot(doc(db, "auctions", id), (docSnapshot) => {
        if (docSnapshot.exists()) {
            const data = docSnapshot.data();
            document.getElementById('modalPrice').innerText = `฿${data.current_price.toLocaleString()}`;
            if(data.end_time_ms) currentProductEndTime = data.end_time_ms;
            if(data.line_id) document.getElementById('modalLine').innerText = data.line_id;
            if(data.phone) document.getElementById('modalPhone').innerText = data.phone;
            if(data.facebook_link) {
                const fbBtn = document.getElementById('modalFacebookLink');
                fbBtn.href = data.facebook_link;
                fbBtn.classList.remove('d-none');
            }
            if(data.seller_uid) {
                getDoc(doc(db, "users", data.seller_uid)).then(uSnap => {
                    if(uSnap.exists()) document.getElementById('modalSellerName').innerText = uSnap.data().displayName;
                });
                if (currentUser && currentUser.uid === data.seller_uid && data.status !== 'sold') {
                    document.getElementById('modalEditBtn').classList.remove('d-none');
                } else {
                    document.getElementById('modalEditBtn').classList.add('d-none');
                }
            }
            if (data.status === 'sold') {
                document.getElementById('soldBadge').classList.remove('d-none');
                document.getElementById('soldMsg').classList.remove('d-none');
                document.getElementById('bidControlSection').classList.add('d-none');
                document.getElementById('buyNowSection').classList.add('d-none');
                document.getElementById('auctionEndedMsg').classList.add('d-none');
                document.getElementById('modalEditBtn').classList.add('d-none');
                currentProductEndTime = 0; 
            } else {
                if (data.buy_now_price && data.buy_now_price > 0) {
                    document.getElementById('buyNowSection').classList.remove('d-none');
                    document.getElementById('buyNowPriceDisplay').innerText = `฿${data.buy_now_price.toLocaleString()}`;
                }
            }
        }
    });
    const bidsRef = collection(db, "auctions", id, "bids");
    const q = query(bidsRef, orderBy("amount", "desc"), limit(20));
    unsubscribeBids = onSnapshot(q, (snapshot) => {
        const historyList = document.getElementById('bidHistoryList');
        historyList.innerHTML = "";
        if (snapshot.empty) {
            historyList.innerHTML = "<div class='text-center text-secondary small mt-4'>ยังไม่มีใครเสนอราคา<br>คุณเริ่มคนแรกเลย!</div>";
        } else {
            snapshot.forEach((doc) => {
                const bid = doc.data();
                const timeStr = bid.timestamp ? new Date(bid.timestamp.seconds * 1000).toLocaleTimeString('th-TH') : "";
                const html = `<div class="bid-history-item d-flex justify-content-between"><div><span class="text-white fw-bold">${bid.bidder_name}</span><span class="text-secondary small ms-2">(${timeStr})</span></div><div class="text-danger fw-bold">฿${bid.amount.toLocaleString()}</div></div>`;
                historyList.innerHTML += html;
            });
        }
    });
    new bootstrap.Modal(document.getElementById('auctionModal')).show();
}
document.getElementById('auctionModal').addEventListener('hidden.bs.modal', () => {
    if (unsubscribeProduct) unsubscribeProduct();
    if (unsubscribeBids) unsubscribeBids();
    currentProductEndTime = null;
});

window.openEditModal = async function() {
    if(!currentProductId) return;
    bootstrap.Modal.getInstance(document.getElementById('auctionModal')).hide();
    toggleLoading(true);
    try {
        const docSnap = await getDoc(doc(db, "auctions", currentProductId));
        if(docSnap.exists()) {
            const data = docSnap.data();
            document.getElementById('editProductId').value = currentProductId;
            document.getElementById('editTitle').value = data.title;
            document.getElementById('editDesc').value = data.description;
            document.getElementById('editPrice').value = data.current_price; 
            document.getElementById('editBuyNowPrice').value = data.buy_now_price || "";
            document.getElementById('editFile').value = data.image_url;
            document.getElementById('editLineId').value = data.line_id || "";
            document.getElementById('editPhone').value = data.phone || "";
            document.getElementById('editFacebook').value = data.facebook_link || "";
            if(data.end_time_ms) {
                const date = new Date(data.end_time_ms);
                const tzOffset = date.getTimezoneOffset() * 60000; 
                const localISOTime = (new Date(date - tzOffset)).toISOString().slice(0, 16);
                document.getElementById('editEndTime').value = localISOTime;
            }
            toggleLoading(false);
            new bootstrap.Modal(document.getElementById('editItemModal')).show();
        }
    } catch(e) { toggleLoading(false); alert("โหลดข้อมูลไม่สำเร็จ"); }
}
const editForm = document.getElementById('editItemForm');
if(editForm) {
    editForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const pid = document.getElementById('editProductId').value;
        if(!pid) return;
        const title = document.getElementById('editTitle').value;
        const desc = document.getElementById('editDesc').value;
        const buyNowPrice = document.getElementById('editBuyNowPrice').value ? Number(document.getElementById('editBuyNowPrice').value) : null;
        const imageUrl = document.getElementById('editFile').value;
        const lineId = document.getElementById('editLineId').value;
        const phone = document.getElementById('editPhone').value;
        const facebook = document.getElementById('editFacebook').value;
        const endTimeInput = document.getElementById('editEndTime').value;
        const endTimeMs = new Date(endTimeInput).getTime();
        try {
            toggleLoading(true);
            await updateDoc(doc(db, "auctions", pid), {
                title: title, description: desc, buy_now_price: buyNowPrice, image_url: imageUrl,
                line_id: lineId, phone: phone, facebook_link: facebook, end_time_ms: endTimeMs,
            });
            toggleLoading(false); alert("แก้ไขสินค้าเรียบร้อย!");
            bootstrap.Modal.getInstance(document.getElementById('editItemModal')).hide();
            location.reload(); 
        } catch(e) { toggleLoading(false); alert("Error: " + e.message); }
    });
}

window.placeBid = async function() {
    if(checkBan()) return;
    if(document.getElementById('navUsername').innerText.includes("Guest (IP ซ้ำ)")) return alert("กรุณากู้คืนบัญชีเดิมก่อนใช้งาน");
    const bidInput = document.getElementById('bidInput');
    const bidAmount = Number(bidInput.value);
    if(!bidAmount || bidAmount <= 0) return alert("กรุณาใส่ราคา");
    try {
        const productRef = doc(db, "auctions", currentProductId);
        const productSnap = await getDoc(productRef);
        if (productSnap.exists()) {
            const data = productSnap.data();
            const now = new Date().getTime();
            if (data.status === 'sold') return alert("สินค้านี้ขายแล้ว!");
            if (data.end_time_ms && now > data.end_time_ms) return alert("หมดเวลาประมูลแล้ว!");
            if (bidAmount <= data.current_price) return alert(`ต้องใส่ราคามากกว่า ฿${data.current_price.toLocaleString()}`);
            const myName = document.getElementById('navUsername').innerText;
            await addDoc(collection(db, "auctions", currentProductId, "bids"), { amount: bidAmount, bidder_uid: currentUser.uid, bidder_name: myName, timestamp: new Date() });
            await updateDoc(productRef, { current_price: bidAmount, last_bidder_uid: currentUser.uid, updated_at: new Date() });
            bidInput.value = "";
        }
    } catch (error) { alert("Error: " + error.message); }
}

window.buyNow = async function() {
    if(checkBan()) return;
    if(document.getElementById('navUsername').innerText.includes("Guest (IP ซ้ำ)")) return alert("กรุณากู้คืนบัญชีเดิมก่อนใช้งาน");
    if(!confirm("ยืนยันการซื้อสดสินค้าชิ้นนี้?")) return;
    try {
        const productRef = doc(db, "auctions", currentProductId);
        const productSnap = await getDoc(productRef);
        if(productSnap.exists()) {
            const data = productSnap.data();
            if (data.status === 'sold') return alert("เสียใจด้วย มีคนซื้อตัดหน้าไปแล้ว!");
            const myName = document.getElementById('navUsername').innerText;
            await updateDoc(productRef, { status: 'sold', buyer_uid: currentUser.uid, current_price: data.buy_now_price, end_time_ms: new Date().getTime(), updated_at: new Date() });
            await addDoc(collection(db, "auctions", currentProductId, "bids"), { amount: data.buy_now_price, bidder_uid: currentUser.uid, bidder_name: myName + " (ซื้อสด!)", timestamp: new Date() });
            alert("ซื้อสินค้าสำเร็จ! ยินดีด้วย 🎉");
        }
    } catch (error) { alert("Error: " + error.message); }
}

window.openAddModal = function() {
    if(checkBan()) return;
    if(document.getElementById('navUsername').innerText.includes("Guest (IP ซ้ำ)")) return alert("กรุณากู้คืนบัญชีเดิมก่อนใช้งาน");
    document.getElementById('addItemForm').reset();
    setupProfileCheckbox('chkProfileLine', userProfileCache.line_id);
    setupProfileCheckbox('chkProfilePhone', userProfileCache.phone);
    setupProfileCheckbox('chkProfileFb', userProfileCache.facebook_link);
    if(userProfileCache.line_id) document.getElementById('chkProfileLine').click();
    if(userProfileCache.phone) document.getElementById('chkProfilePhone').click();
    if(userProfileCache.facebook_link) document.getElementById('chkProfileFb').click();
    new bootstrap.Modal(document.getElementById('addItemModal')).show();
}
function setupProfileCheckbox(chkId, dataValue) {
    const chk = document.getElementById(chkId);
    if (!dataValue) { chk.disabled = true; chk.parentElement.querySelector('label').innerText += " (ไม่มี)"; } 
    else { chk.disabled = false; let label = chk.parentElement.querySelector('label').innerText; chk.parentElement.querySelector('label').innerText = label.replace(" (ไม่มี)", ""); }
}
window.toggleContactInput = function(chkId, inputId, dataKey) {
    const isChecked = document.getElementById(chkId).checked;
    const inputEl = document.getElementById(inputId);
    if (isChecked) { inputEl.value = userProfileCache[dataKey] || ""; inputEl.readOnly = true; inputEl.classList.add('bg-secondary', 'text-white'); } 
    else { inputEl.value = ""; inputEl.readOnly = false; inputEl.classList.remove('bg-secondary', 'text-white'); }
}
const addForm = document.getElementById('addItemForm');
if(addForm) {
    addForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        if(checkBan()) return;
        const title = document.getElementById('inpTitle').value;
        const desc = document.getElementById('inpDesc').value;
        const price = Number(document.getElementById('inpPrice').value);
        const buyNowPrice = document.getElementById('inpBuyNowPrice').value ? Number(document.getElementById('inpBuyNowPrice').value) : null;
        const lineId = document.getElementById('inpLineId').value.trim();
        const phone = document.getElementById('inpPhone').value.trim();
        const facebookLink = document.getElementById('inpFacebook').value.trim();
        const imageUrl = document.getElementById('inpFile').value;
        const endTimeInput = document.getElementById('inpEndTime').value;
        if (!lineId && !phone && !facebookLink) return alert("กรุณาระบุช่องทางติดต่ออย่างน้อย 1 อย่าง");
        if(!endTimeInput) return alert("กรุณาระบุเวลาปิดประมูล");
        const endTimeMs = new Date(endTimeInput).getTime();
        try {
            toggleLoading(true);
            await addDoc(collection(db, "auctions"), {
                title: title, description: desc, current_price: price, buy_now_price: buyNowPrice,
                line_id: lineId, phone: phone, facebook_link: facebookLink,
                status: 'active', image_url: imageUrl, seller_uid: currentUser.uid,
                end_time_ms: endTimeMs, created_at: new Date()
            });
            toggleLoading(false); alert("ลงสินค้าเรียบร้อย!"); location.reload(); 
        } catch (error) { toggleLoading(false); alert("Error: " + error.message); }
    });
}

window.openProfileModal = function() {
    if(!currentUser) return;
    document.getElementById('profileNameInput').value = document.getElementById('navUsername').innerText;
    new bootstrap.Modal(document.getElementById('profileModal')).show();
}
window.updateUserProfile = async function() {
    const newName = document.getElementById('profileNameInput').value;
    const newSecret = document.getElementById('profileSecretCode').value;
    const newLine = document.getElementById('profileLine').value;
    const newPhone = document.getElementById('profilePhone').value;
    const newFb = document.getElementById('profileFb').value;
    if(newName && currentUser) {
        toggleLoading(true);
        await updateDoc(doc(db, "users", currentUser.uid), { displayName: newName, secret_code: newSecret, line_id: newLine, phone: newPhone, facebook_link: newFb });
        toggleLoading(false); alert("บันทึกข้อมูลเรียบร้อย");
        bootstrap.Modal.getInstance(document.getElementById('profileModal')).hide();
    }
}
window.openRecoverModal = function() { new bootstrap.Modal(document.getElementById('recoverModal')).show(); }
window.recoverAccount = async function() {
    const oldName = document.getElementById('recoverOldName').value.trim();
    const secretCode = document.getElementById('recoverSecretCode').value.trim();
    if(!oldName || !secretCode) return alert("กรุณากรอกข้อมูล");
    try {
        toggleLoading(true);
        const qUser = query(collection(db, "users"), where("displayName", "==", oldName));
        const querySnapshot = await getDocs(qUser);
        if(querySnapshot.empty) { toggleLoading(false); return alert(`ไม่พบชื่อ "${oldName}"`); }
        const oldUserDoc = querySnapshot.docs[0]; 
        const oldUserData = oldUserDoc.data();
        if(oldUserData.secret_code !== secretCode) { toggleLoading(false); return alert("รหัสผิด"); }
        if(oldUserDoc.id === currentUser.uid) { toggleLoading(false); return alert("บัญชีเดียวกัน"); }
        await updateDoc(doc(db, "users", currentUser.uid), { displayName: oldUserData.displayName, migrated_from: oldUserDoc.id });
        const qProduct = query(collection(db, "auctions"), where("seller_uid", "==", oldUserDoc.id));
        const productSnaps = await getDocs(qProduct);
        const updates = [];
        productSnaps.forEach((docSnap) => { updates.push(updateDoc(docSnap.ref, { seller_uid: currentUser.uid })); });
        await Promise.all(updates);
        await updateDoc(oldUserDoc.ref, { displayName: oldUserData.displayName + "_old", is_migrated: true });
        toggleLoading(false); alert(`ย้ายสำเร็จ! ยินดีต้อนรับ ${oldUserData.displayName}`); location.reload();
    } catch (error) { toggleLoading(false); alert("Error: " + error.message); }
}
function toggleLoading(show) { const loader = document.getElementById('loading'); if(loader) loader.style.display = show ? 'block' : 'none'; }
function checkBan() { if(isBanned) { alert("คุณถูกระงับการใช้งาน"); return true; } return false; }
