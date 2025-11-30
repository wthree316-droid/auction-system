import { db, auth } from "./firebase-config.js";
import { collection, addDoc, getDocs, doc, getDoc, setDoc, updateDoc, query, orderBy, onSnapshot, limit, where, writeBatch } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { signInAnonymously, onAuthStateChanged, linkWithCredential, EmailAuthProvider, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { supabase } from "./supabase-client.js";

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

// ==========================================
// A. ระบบค้นหา & กรอง
// ==========================================
const searchInput = document.getElementById('searchInput');
const filterCategory = document.getElementById('filterCategory');
const sortOption = document.getElementById('sortOption');

if(searchInput) searchInput.addEventListener('input', applyFilters);
if(filterCategory) filterCategory.addEventListener('change', applyFilters);
if(sortOption) sortOption.addEventListener('change', applyFilters);

function applyFilters() {
    let result = [...allProducts];
    const keyword = searchInput.value.toLowerCase();
    if (keyword) result = result.filter(p => p.title.toLowerCase().includes(keyword));
    
    const category = filterCategory.value;
    if (category && category !== 'all') result = result.filter(p => p.category === category);
    
    const sortBy = sortOption.value;
    if (sortBy === 'newest') result.sort((a, b) => (b.created_at?.seconds || 0) - (a.created_at?.seconds || 0));
    else if (sortBy === 'ending_soon') {
        const now = new Date().getTime();
        result.sort((a, b) => (a.end_time_ms - now) - (b.end_time_ms - now));
    } else if (sortBy === 'price_asc') {
        result.sort((a, b) => a.current_price - b.current_price);
    } else if (sortBy === 'price_desc') {
        result.sort((a, b) => b.current_price - a.current_price);
    }
    
    renderProducts(result);
}

function renderProducts(products) {
    const listContainer = document.getElementById('productList');
    if(!listContainer) return;
    listContainer.innerHTML = "";
    
    if(products.length === 0) {
        listContainer.innerHTML = `
            <div class="col-12 text-center py-5 text-secondary opacity-50">
                <i class="bi bi-inbox display-1"></i>
                <p class="mt-3">ไม่พบสินค้าตามเงื่อนไข</p>
            </div>`;
        return;
    }

    products.forEach(item => {
        const safeTitle = item.title.replace(/'/g, "\\'");
        const safeDesc = item.description ? item.description.replace(/'/g, "\\'").replace(/"/g, '&quot;') : "";
        const timerId = `timer-${item.id}`;
        const badgeId = `badge-${item.id}`;
        const endTime = item.end_time_ms || 0;
        
        let soldOverlay = item.status === 'sold' ? `<div class="position-absolute top-50 start-50 translate-middle bg-danger text-white px-3 py-1 fw-bold fs-4 rotate-n15 border border-2 border-white opacity-75" style="transform: translate(-50%, -50%) rotate(-15deg); z-index:10;">SOLD</div>` : "";
        
        const catMap = { 'it': 'ไอที', 'fashion': 'แฟชั่น', 'amulet': 'พระเครื่อง', 'home': 'ของใช้', 'other': 'อื่นๆ' };
        const catName = catMap[item.category] || 'อื่นๆ';

        // 🔥 ดึงชื่อผู้ขายมาแสดง (ถ้ามีบันทึกไว้)
        const sellerName = item.seller_name || "ผู้ขาย";

        const html = `
            <div class="col-6 col-md-4 col-lg-3">
                <div class="card h-100 cursor-pointer position-relative card-custom" onclick="openAuction('${item.id}', '${safeTitle}', '${item.current_price}', '${item.image_url}', \`${safeDesc}\`)" style="cursor: pointer;">
                    ${soldOverlay}
                    <div class="position-absolute top-0 start-0 p-2"><span class="badge badge-glass text-white">${catName}</span></div>
                    <div class="position-absolute top-0 end-0 p-2"><span id="${badgeId}" class="badge bg-warning text-dark shadow"><i class="bi bi-clock"></i> <span id="${timerId}" class="card-timer" data-end-time="${endTime}">--:--</span></span></div>
                    
                    <div class="product-img-wrapper"><img src="${item.image_url}" class="product-img-list" alt="${item.title}"></div>
                    
                    <div class="card-body p-3">
                        <h6 class="card-title text-truncate mb-1 fw-bold text-white">${item.title}</h6>
                        <p class="card-text text-danger fw-bold mb-2 h5">฿${item.current_price.toLocaleString()}</p>
                        
                        <div class="d-flex align-items-center gap-2 pt-2 border-top border-secondary mt-2">
                            <i class="bi bi-person-circle text-secondary"></i>
                            <small class="text-secondary text-truncate" style="max-width: 100px;">${sellerName}</small>
                        </div>
                    </div>
                </div>
            </div>
        `;
        listContainer.innerHTML += html;
    });
}

// ==========================================
// B. Dashboard
// ==========================================
window.openDashboardModal = async function() {
    new bootstrap.Modal(document.getElementById('dashboardModal')).show();
    if(!currentUser) return;
    
    const mySellingContainer = document.getElementById('mySellingList');
    mySellingContainer.innerHTML = "<p class='text-center w-100 small text-secondary py-3'>กำลังโหลด...</p>";
    const myItems = allProducts.filter(p => p.seller_uid === currentUser.uid);
    mySellingContainer.innerHTML = "";
    if(myItems.length === 0) mySellingContainer.innerHTML = "<p class='text-center w-100 small text-secondary py-3'>คุณยังไม่ได้ลงขายสินค้า</p>";
    
    myItems.forEach(item => {
        const statusBadge = item.status === 'sold' ? '<span class="badge bg-success">ขายแล้ว</span>' : '<span class="badge bg-primary">กำลังขาย</span>';
        mySellingContainer.innerHTML += `
            <div class="col-12 col-md-6"><div class="border border-secondary p-2 rounded bg-black d-flex gap-3 align-items-center" onclick="openAuction('${item.id}', '${item.title}', '${item.current_price}', '${item.image_url}', '')" style="cursor:pointer">
            <img src="${item.image_url}" style="width:60px; height:60px; object-fit:cover" class="rounded border border-secondary"><div style="overflow:hidden" class="flex-grow-1"><div class="text-truncate fw-bold text-white">${item.title}</div><div class="d-flex justify-content-between align-items-center mt-1"><span class="text-warning fw-bold">฿${item.current_price.toLocaleString()}</span>${statusBadge}</div></div></div></div>`;
    });

    const myBiddingContainer = document.getElementById('myBiddingList');
    myBiddingContainer.innerHTML = `<div class="col-12 text-center py-5"><div class="spinner-border text-info" role="status"></div><p class="text-info mt-2 small">กำลังไล่เช็คลำดับของคุณ...</p></div>`;

    const biddingPromises = allProducts.map(async (item) => {
        if (item.seller_uid === currentUser.uid) return null;
        if (item.last_bidder_uid === currentUser.uid || item.buyer_uid === currentUser.uid) {
            return { item: item, myRank: 1, myMaxBid: item.current_price, isWinner: item.status === 'sold' && item.buyer_uid === currentUser.uid };
        }
        try {
            const bidsRef = collection(db, "auctions", item.id, "bids");
            const bidsSnap = await getDocs(bidsRef);
            if (bidsSnap.empty) return null;
            const allBidders = {};
            bidsSnap.forEach(doc => {
                const b = doc.data();
                if (!allBidders[b.bidder_uid] || b.amount > allBidders[b.bidder_uid]) {
                    allBidders[b.bidder_uid] = b.amount;
                }
            });
            if (!allBidders[currentUser.uid]) return null;
            const sortedRanks = Object.keys(allBidders).sort((a, b) => allBidders[b] - allBidders[a]);
            const myRank = sortedRanks.indexOf(currentUser.uid) + 1;
            const myMaxBid = allBidders[currentUser.uid];
            return { item: item, myRank: myRank, myMaxBid: myMaxBid, isWinner: false };
        } catch (e) { return null; }
    });

    const results = await Promise.all(biddingPromises);
    const myParticipatingItems = results.filter(r => r !== null);

    myBiddingContainer.innerHTML = "";
    if (myParticipatingItems.length === 0) {
        myBiddingContainer.innerHTML = "<p class='text-center w-100 small text-secondary py-3'>คุณยังไม่ได้ร่วมประมูลสินค้าใดๆ</p>";
        return;
    }
    myParticipatingItems.sort((a, b) => a.myRank - b.myRank);

    myParticipatingItems.forEach(data => {
        const { item, myRank, myMaxBid, isWinner } = data;
        let rankClass = "rank-other", rankText = `ลำดับที่ ${myRank}`;
        if (isWinner) { rankClass = "bg-success text-white"; rankText = "🏆 ชนะประมูล!"; }
        else if (myRank === 1) { rankClass = "rank-1"; rankText = "🥇 ผู้นำสูงสุด"; }
        else if (myRank === 2) { rankClass = "rank-2"; rankText = "🥈 ลำดับที่ 2"; }
        else if (myRank === 3) { rankClass = "rank-3"; rankText = "🥉 ลำดับที่ 3"; }

        const isSold = item.status === 'sold';
        const statusMsg = isSold ? (isWinner ? "จบแล้ว (คุณได้ของ)" : "จบแล้ว (แพ้)") : "กำลังแข่ง...";
        const cardBorder = isWinner ? "border-success" : (myRank === 1 ? "border-warning" : "border-secondary");

        myBiddingContainer.innerHTML += `
            <div class="col-12 col-md-6"><div class="border ${cardBorder} p-2 rounded bg-black d-flex gap-3 align-items-center position-relative" onclick="openAuction('${item.id}', '${item.title}', '${item.current_price}', '${item.image_url}', '')" style="cursor:pointer"><img src="${item.image_url}" style="width:70px; height:70px; object-fit:cover" class="rounded"><div style="overflow:hidden" class="flex-grow-1"><div class="text-truncate fw-bold text-white mb-1">${item.title}</div><div class="d-flex justify-content-between align-items-center"><div><span class="rank-badge ${rankClass}">${rankText}</span></div><div class="text-end"><div class="small text-secondary" style="font-size:0.7rem;">ราคาปัจจุบัน</div><div class="text-danger fw-bold">฿${item.current_price.toLocaleString()}</div></div></div><div class="d-flex justify-content-between align-items-center mt-2 border-top border-secondary pt-1"><span class="small text-secondary" style="font-size:0.75rem;">${statusMsg}</span><span class="small text-muted" style="font-size:0.75rem;">เสนอไป: ฿${myMaxBid.toLocaleString()}</span></div></div></div></div>`;
    });
}

// ==========================================
// C. Load Products
// ==========================================
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
        applyFilters();
    });
}
loadProducts();

// ==========================================
// D. Auth & User Profile & IP Lock
// ==========================================
function generateRandomCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = ''; for (let i = 0; i < 13; i++) { result += chars.charAt(Math.floor(Math.random() * chars.length)); } return result;
}

async function initSystem() {
    try {
        const res = await fetch('https://api.ipify.org?format=json');
        const data = await res.json();
        currentIp = data.ip;
    } catch (e) { }
    signInAnonymously(auth).catch((error) => console.error("Login Error:", error));
}
initSystem();

window.logoutSystem = async function() {
    if(!confirm("ยืนยันการออกจากระบบ?")) return;
    await signOut(auth);
    window.location.reload(); 
}

onAuthStateChanged(auth, async (user) => {
    if (user) {
        currentUser = user;
        
        // Toggle Button
        const btnLogin = document.getElementById('btnLogin');
        const btnLogout = document.getElementById('btnLogout');
        if (user.isAnonymous) {
            if(btnLogin) btnLogin.classList.remove('d-none');
            if(btnLogout) btnLogout.classList.add('d-none');
        } else {
            if(btnLogin) btnLogin.classList.add('d-none');
            if(btnLogout) btnLogout.classList.remove('d-none');
        }

        const userRef = doc(db, "users", user.uid);
        const userSnap = await getDoc(userRef);

        if (userSnap.exists()) {
            onSnapshot(userRef, (docSnap) => {
                if (docSnap.exists()) setupUserProfile(docSnap.data());
            });
        } else {
            // IP Check (Prevent Spam)
            if (user.isAnonymous) {
                const usersRef = collection(db, "users");
                const qIp = query(usersRef, where("ip_address", "==", currentIp));
                const ipSnap = await getDocs(qIp);
                if (!ipSnap.empty) {
                    const existingUser = ipSnap.docs[0].data();
                    alert(`⚠️ IP นี้ (${currentIp}) มีบัญชีแล้วชื่อ "${existingUser.displayName}"\nกรุณาใช้การย้ายเครื่อง หรือ Login`);
                    updateUIName("Guest (IP ซ้ำ)");
                    return; 
                }
            }
            const defaultName = "User_" + user.uid.slice(0,4);
            const autoSecret = generateRandomCode(); 
            await setDoc(userRef, { 
                displayName: defaultName, uid: user.uid, secret_code: autoSecret, 
                ip_address: currentIp, contact_email: user.email || "", created_at: new Date() 
            });
            onSnapshot(userRef, (docSnap) => { if (docSnap.exists()) setupUserProfile(docSnap.data()); });
        }
    }
});

function setupUserProfile(data) {
    userProfileCache = data;
    isBanned = data.is_banned;
    updateUIName(data.displayName);
    if(document.getElementById('profileSecretCode')) {
        document.getElementById('profileSecretCode').value = data.secret_code || "";
        document.getElementById('profileEmail').value = data.contact_email || ""; 
    }
    const isLinked = currentUser.providerData.some(p => p.providerId === 'password');
    if(isLinked && document.getElementById('linkAccountSection')) {
        document.getElementById('linkAccountSection').innerHTML = `<div class="text-success text-center py-2"><i class="bi bi-check-circle-fill"></i> บัญชีนี้ผูกกับอีเมลแล้ว</div>`;
    }
    if(isBanned) document.body.innerHTML = "<div class='vh-100 d-flex justify-content-center align-items-center bg-black'><h1 class='text-danger'>🚫 BANNED</h1></div>";
}
function updateUIName(name) { const el = document.getElementById('navUsername'); if(el) el.innerText = name; }

// ==========================================
// E. Timer
// ==========================================
setInterval(() => {
    if (currentProductEndTime && document.getElementById('auctionModal').classList.contains('show')) { updateTimerUI(currentProductEndTime, 'modalTimer', 'modalTimerBadge', true); }
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
            if(document.getElementById('soldBadge').classList.contains('d-none')) { document.getElementById('auctionEndedMsg').classList.remove('d-none'); } else { document.getElementById('auctionEndedMsg').classList.add('d-none'); }
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
        if(distance < 5 * 60 * 1000 && badgeEl) { badgeEl.className = "badge bg-danger animate__animated animate__flash"; }
    }
}

// ==========================================
// F. Modal Logic
// ==========================================
window.openAuction = function(id, title, price, img, desc) {
    currentProductId = id;
    document.getElementById('modalTitle').innerText = title;
    document.getElementById('modalImage').src = img;
    document.getElementById('modalDesc').innerText = desc;
    document.getElementById('bidInput').value = "";
    document.getElementById('bidHistoryList').innerHTML = "<div class='text-center small mt-4 text-secondary'>กำลังโหลดประวัติ...</div>";
    document.getElementById('bidControlSection').classList.remove('d-none');
    document.getElementById('auctionEndedMsg').classList.add('d-none');
    document.getElementById('soldMsg').classList.add('d-none');
    document.getElementById('soldBadge').classList.add('d-none');
    document.getElementById('buyNowSection').classList.add('d-none');
    document.getElementById('modalSellerName').innerText = "กำลังโหลด...";
    document.getElementById('modalEmailLink').classList.add('d-none');
    document.getElementById('modalEditBtn').classList.add('d-none');
    
    document.getElementById('modalCategoryBadge').innerText = "หมวดหมู่";

    if (unsubscribeProduct) unsubscribeProduct();
    if (unsubscribeBids) unsubscribeBids();

    unsubscribeProduct = onSnapshot(doc(db, "auctions", id), (docSnapshot) => {
        if (docSnapshot.exists()) {
            const data = docSnapshot.data();
            document.getElementById('modalPrice').innerText = `฿${data.current_price.toLocaleString()}`;
            if(data.end_time_ms) currentProductEndTime = data.end_time_ms;
            
            if(data.contact_email) {
                document.getElementById('modalEmailLink').href = `mailto:${data.contact_email}`;
                document.getElementById('modalEmailLink').classList.remove('d-none');
            }
            
            const catMap = { 'it': 'ไอที', 'fashion': 'แฟชั่น', 'amulet': 'พระเครื่อง', 'home': 'ของใช้', 'other': 'อื่นๆ' };
            document.getElementById('modalCategoryBadge').innerText = catMap[data.category] || 'สินค้าทั่วไป';

            // 🔥 Seller Name
            if (data.seller_name) {
                document.getElementById('modalSellerName').innerText = data.seller_name;
            } else if(data.seller_uid) {
                getDoc(doc(db, "users", data.seller_uid)).then(uSnap => {
                    if(uSnap.exists()) document.getElementById('modalSellerName').innerText = uSnap.data().displayName;
                });
            }

            if (currentUser && currentUser.uid === data.seller_uid && data.status !== 'sold') {
                document.getElementById('modalEditBtn').classList.remove('d-none');
            } else {
                document.getElementById('modalEditBtn').classList.add('d-none');
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
        if(document.getElementById('bidCount')) document.getElementById('bidCount').innerText = snapshot.size;
        
        historyList.innerHTML = "";
        if (snapshot.empty) {
            historyList.innerHTML = "<div class='text-center text-secondary small mt-4'>ยังไม่มีข้อเสนอ<br>เป็นคนแรกสิ!</div>";
        } else {
            snapshot.forEach((doc) => {
                const bid = doc.data();
                const timeStr = bid.timestamp ? new Date(bid.timestamp.seconds * 1000).toLocaleTimeString('th-TH', {hour:'2-digit', minute:'2-digit'}) : "";
                const html = `
                    <div class="bid-history-item d-flex justify-content-between border-bottom border-secondary py-2 px-2 align-items-center" style="border-color: #333 !important;">
                        <div class="d-flex align-items-center gap-2">
                            <i class="bi bi-person-circle text-secondary"></i>
                            <div>
                                <div class="text-white fw-bold small">${bid.bidder_name}</div>
                                <small class="text-secondary" style="font-size: 0.65rem;">${timeStr}</small>
                            </div>
                        </div>
                        <div class="text-success fw-bold">฿${bid.amount.toLocaleString()}</div>
                    </div>`;
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

//  ฟังก์ชันช่วยอัปโหลดรูปไป Supabase

async function uploadImageToSupabase(file) {
    const fileName = `${Date.now()}_${file.name.replace(/\s+/g, '-')}`; // ตั้งชื่อไฟล์ไม่ให้ซ้ำ
    const { data, error } = await supabase.storage
        .from('images') // ⚠️ ชื่อ Bucket ต้องตรงกับใน Supabase
        .upload(fileName, file);

    if (error) {
        console.error("Supabase Upload Error:", error);
        throw new Error("อัปโหลดรูปไม่สำเร็จ: " + error.message);
    }

    // ดึง Public URL
    const { data: publicData } = supabase.storage
        .from('images')
        .getPublicUrl(fileName);
        
    return publicData.publicUrl;
}

// ==========================================
// G. Add Item & Edit Item (Modified for Upload)
// ==========================================

// 1. ลงสินค้าใหม่
const addForm = document.getElementById('addItemForm');
if(addForm) {
    addForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        if(checkBan()) return;
        
        const title = document.getElementById('inpTitle').value;
        const desc = document.getElementById('inpDesc').value;
        const price = Number(document.getElementById('inpPrice').value);
        const buyNowPrice = document.getElementById('inpBuyNowPrice').value ? Number(document.getElementById('inpBuyNowPrice').value) : null;
        const email = document.getElementById('inpEmail').value.trim();
        const fileInput = document.getElementById('inpFile'); // รับไฟล์จาก Input
        const endTimeInput = document.getElementById('inpEndTime').value;
        const category = document.getElementById('inpCategory').value;
        
        if (!category) return alert("กรุณาเลือกหมวดหมู่สินค้า");
        if (!email) return alert("กรุณาระบุอีเมลสำหรับติดต่อ");
        if (!endTimeInput) return alert("ระบุเวลาปิดประมูล");
        if (fileInput.files.length === 0) return alert("กรุณาเลือกรูปภาพสินค้า"); // เช็คไฟล์

        const endTimeMs = new Date(endTimeInput).getTime();
        const myName = document.getElementById('navUsername').innerText;

        try {
            toggleLoading(true);
            
            // 🔥 อัปโหลดรูปก่อน
            const file = fileInput.files[0];
            const imageUrl = await uploadImageToSupabase(file);

            // บันทึกข้อมูลลง Firestore
            await addDoc(collection(db, "auctions"), {
                title: title, 
                category: category, 
                description: desc, 
                current_price: price, 
                buy_now_price: buyNowPrice,
                contact_email: email,
                image_url: imageUrl, // ใช้ URL จาก Supabase
                status: 'active', 
                seller_uid: currentUser.uid, 
                seller_name: myName,
                end_time_ms: endTimeMs, 
                created_at: new Date()
            });
            
            toggleLoading(false); 
            alert("ลงสินค้าเรียบร้อย!"); 
            location.reload(); 
        } catch (error) { 
            toggleLoading(false); 
            alert("Error: " + error.message); 
        }
    });
}

// 2. เปิดหน้าแก้ไขสินค้า (โหลดรูปเดิมมาโชว์)
window.openEditModal = async function() {
    if(!currentProductId) return;
    bootstrap.Modal.getInstance(document.getElementById('auctionModal')).hide();
    
    toggleLoading(true);
    const docSnap = await getDoc(doc(db, "auctions", currentProductId));
    
    if(docSnap.exists()) {
        const data = docSnap.data();
        document.getElementById('editProductId').value = currentProductId;
        document.getElementById('editTitle').value = data.title;
        document.getElementById('editDesc').value = data.description;
        document.getElementById('editCategory').value = data.category || "other"; 
        document.getElementById('editPrice').value = data.current_price; 
        document.getElementById('editBuyNowPrice').value = data.buy_now_price || "";
        
        // เก็บ URL รูปเดิมไว้ใน Hidden Input และแสดงตัวอย่าง
        document.getElementById('currentImageUrl').value = data.image_url;
        document.getElementById('editCurrentImgDisplay').src = data.image_url;
        document.getElementById('editFile').value = ""; // เคลียร์ช่องเลือกไฟล์ใหม่

        document.getElementById('editEmail').value = data.contact_email || "";
        if(data.end_time_ms) {
            const date = new Date(data.end_time_ms);
            const tzOffset = date.getTimezoneOffset() * 60000; 
            const localISOTime = (new Date(date - tzOffset)).toISOString().slice(0, 16);
            document.getElementById('editEndTime').value = localISOTime;
        }
        toggleLoading(false);
        new bootstrap.Modal(document.getElementById('editItemModal')).show();
    }
}

// 3. บันทึกการแก้ไข (เช็คว่าเปลี่ยนรูปไหม)
const editForm = document.getElementById('editItemForm');
if(editForm) {
    editForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const pid = document.getElementById('editProductId').value;
        const endTimeMs = new Date(document.getElementById('editEndTime').value).getTime();
        const fileInput = document.getElementById('editFile');
        
        try {
            toggleLoading(true);
            
            let imageUrl = document.getElementById('currentImageUrl').value; // ใช้รูปเดิมเป็นค่าเริ่มต้น

            // 🔥 ถ้ามีการเลือกไฟล์ใหม่ ให้อัปโหลดใหม่
            if (fileInput.files.length > 0) {
                const file = fileInput.files[0];
                imageUrl = await uploadImageToSupabase(file);
            }

            await updateDoc(doc(db, "auctions", pid), {
                title: document.getElementById('editTitle').value,
                description: document.getElementById('editDesc').value,
                category: document.getElementById('editCategory').value,
                buy_now_price: document.getElementById('editBuyNowPrice').value ? Number(document.getElementById('editBuyNowPrice').value) : null,
                image_url: imageUrl, // ใช้ URL ใหม่ (หรือเก่า)
                contact_email: document.getElementById('editEmail').value,
                end_time_ms: endTimeMs,
            });

            toggleLoading(false); 
            alert("แก้ไขสินค้าเรียบร้อย!"); 
            bootstrap.Modal.getInstance(document.getElementById('editItemModal')).hide(); 
            location.reload(); 
        } catch(e) { 
            toggleLoading(false); 
            alert("Error: " + e.message); 
        }
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
    setupProfileCheckbox('chkProfileEmail', userProfileCache.contact_email);
    if(userProfileCache.contact_email) document.getElementById('chkProfileEmail').click();
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
window.openProfileModal = function() {
    if(!currentUser) return;
    document.getElementById('profileNameInput').value = document.getElementById('navUsername').innerText;
    new bootstrap.Modal(document.getElementById('profileModal')).show();
}
window.updateUserProfile = async function() {
    const newName = document.getElementById('profileNameInput').value;
    if(newName && currentUser) {
        toggleLoading(true);
        await updateDoc(doc(db, "users", currentUser.uid), { displayName: newName, contact_email: document.getElementById('profileEmail').value });
        toggleLoading(false); alert("บันทึกข้อมูลเรียบร้อย");
        bootstrap.Modal.getInstance(document.getElementById('profileModal')).hide();
    }
}
window.linkAccount = async function() {
    const email = document.getElementById('linkEmail').value.trim();
    const password = document.getElementById('linkPassword').value;
    if(!email || password.length < 6) return alert("กรอกอีเมลและรหัสผ่าน (6 ตัวขึ้นไป)");
    try {
        toggleLoading(true);
        const credential = EmailAuthProvider.credential(email, password);
        await linkWithCredential(currentUser, credential);
        await updateDoc(doc(db, "users", currentUser.uid), { contact_email: email });
        toggleLoading(false); alert("✅ ผูกบัญชีสำเร็จ!");
        document.getElementById('linkAccountSection').innerHTML = `<div class="text-success text-center py-2"><i class="bi bi-check-circle-fill"></i> บัญชีนี้ผูกกับอีเมลแล้ว</div>`;
    } catch (error) { toggleLoading(false); alert("Error: " + error.message); }
}
window.copySecret = function() {
    const copyText = document.getElementById("profileSecretCode");
    copyText.select(); navigator.clipboard.writeText(copyText.value);
    alert("คัดลอกรหัสลับแล้ว");
}
window.openRecoverModal = function() { new bootstrap.Modal(document.getElementById('recoverModal')).show(); }
window.recoverAccount = async function() {
    const secretCode = document.getElementById('recoverSecretCode').value.trim();
    if(!secretCode) return alert("กรุณากรอกรหัสลับ");
    try {
        toggleLoading(true);
        const qUser = query(collection(db, "users"), where("secret_code", "==", secretCode));
        const querySnapshot = await getDocs(qUser);
        if(querySnapshot.empty) { toggleLoading(false); return alert("รหัสลับไม่ถูกต้อง หรือไม่พบข้อมูล"); }
        const oldUserDoc = querySnapshot.docs[0]; 
        const oldUserData = oldUserDoc.data();
        if(oldUserDoc.id === currentUser.uid) { toggleLoading(false); return alert("คุณกำลังใช้บัญชีนี้อยู่แล้ว"); }
        await updateDoc(doc(db, "users", currentUser.uid), { displayName: oldUserData.displayName, migrated_from: oldUserDoc.id });
        const qProduct = query(collection(db, "auctions"), where("seller_uid", "==", oldUserDoc.id));
        const productSnaps = await getDocs(qProduct);
        const batch1 = writeBatch(db);
        productSnaps.forEach((docSnap) => { batch1.update(docSnap.ref, { seller_uid: currentUser.uid }); });
        await batch1.commit();
        const qBids = query(collection(db, "auctions"), where("last_bidder_uid", "==", oldUserDoc.id));
        const bidSnaps = await getDocs(qBids);
        const batch2 = writeBatch(db);
        bidSnaps.forEach((docSnap) => { batch2.update(docSnap.ref, { last_bidder_uid: currentUser.uid }); });
        await batch2.commit();
        const qWins = query(collection(db, "auctions"), where("buyer_uid", "==", oldUserDoc.id));
        const winSnaps = await getDocs(qWins);
        const batch3 = writeBatch(db);
        winSnaps.forEach((docSnap) => { batch3.update(docSnap.ref, { buyer_uid: currentUser.uid }); });
        await batch3.commit();
        await updateDoc(oldUserDoc.ref, { displayName: oldUserData.displayName + "_old", is_migrated: true });
        toggleLoading(false); alert(`ย้ายสำเร็จ! ยินดีต้อนรับ ${oldUserData.displayName}`); location.reload();
    } catch (error) { toggleLoading(false); alert("Error: " + error.message); }
}
function toggleLoading(show) { const loader = document.getElementById('loading'); if(loader) loader.style.display = show ? 'block' : 'none'; }
function checkBan() { if(isBanned) { alert("คุณถูกระงับการใช้งาน"); return true; } return false; }

