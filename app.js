import { AuthService, UserService, AuctionService, StorageService } from "./api.js";

// Variables (คงเดิม)
let currentUser = null;
let currentIp = "Unknown";
let isBanned = false;
let userProfileCache = {};
let allProducts = []; 

let currentProductId = null;
let currentProductEndTime = null; 
let unsubscribeProduct = null;
let unsubscribeBids = null;
let currentSellerId = null;

// ==========================================
// A. ระบบค้นหา & กรอง (UPDATE รองรับ Header ใหม่)
// ==========================================
const searchInput = document.getElementById('searchInput');

// ตัวกรอง Desktop
const filterCategory = document.getElementById('filterCategory');
const sortOption = document.getElementById('sortOption');

// ตัวกรอง Mobile (เพิ่มใหม่)
const mobileFilterCategory = document.getElementById('mobileFilterCategory');
const mobileSortOption = document.getElementById('mobileSortOption');

// Event Listeners
if(searchInput) searchInput.addEventListener('input', applyFilters);

// ผูก Events ทั้ง Desktop และ Mobile
if(filterCategory) filterCategory.addEventListener('change', () => {
    // ถ้าแก้ Desktop ให้ซิงค์ไป Mobile ด้วย (เผื่อจอย่อขยาย)
    if(mobileFilterCategory) mobileFilterCategory.value = filterCategory.value;
    applyFilters();
});
if(sortOption) sortOption.addEventListener('change', () => {
    if(mobileSortOption) mobileSortOption.value = sortOption.value;
    applyFilters();
});

// ผูก Events ฝั่ง Mobile
if(mobileFilterCategory) mobileFilterCategory.addEventListener('change', () => {
    if(filterCategory) filterCategory.value = mobileFilterCategory.value; // ซิงค์กลับ Desktop
    applyFilters();
});
if(mobileSortOption) mobileSortOption.addEventListener('change', () => {
    if(sortOption) sortOption.value = mobileSortOption.value; // ซิงค์กลับ Desktop
    applyFilters();
});

function applyFilters() {
    let result = [...allProducts];
    
    // 1. ค้นหาจากชื่อ
    const keyword = searchInput ? searchInput.value.toLowerCase() : "";
    if (keyword) result = result.filter(p => p.title.toLowerCase().includes(keyword));
    
    // 2. กรองหมวดหมู่ (อ่านจาก Desktop เป็นหลัก เพราะเราซิงค์ค่ากันแล้ว)
    const category = filterCategory ? filterCategory.value : 'all';
    if (category && category !== 'all') result = result.filter(p => p.category === category);
    
    // 3. เรียงลำดับ (อ่านจาก Desktop เป็นหลัก)
    const sortBy = sortOption ? sortOption.value : 'newest';
    
    if (sortBy === 'newest') {
        result.sort((a, b) => (b.created_at?.seconds || 0) - (a.created_at?.seconds || 0));
    } else if (sortBy === 'ending_soon') {
        const now = new Date().getTime();
        // เอาเฉพาะที่ยังไม่จบมาเรียงก่อน (หรือเรียงตามเวลาที่เหลือ)
        result.sort((a, b) => (a.end_time - now) - (b.end_time - now));
    } else if (sortBy === 'price_asc') {
        result.sort((a, b) => (a.current_price || a.buy_now_price || 0) - (b.current_price || b.buy_now_price || 0));
    } else if (sortBy === 'price_desc') {
        result.sort((a, b) => (b.current_price || b.buy_now_price || 0) - (a.current_price || a.buy_now_price || 0));
    }
    
    renderProducts(result);
}

// 🔥 ฟังก์ชันแสดงผลสินค้า (UI Logic คงเดิม)
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

    // สร้างตัวแปรเก็บ HTML ก้อนใหญ่ไว้นอก Loop
    let allCardsHtml = ""; 

    products.forEach(item => {
        // 1. ตัวแปรที่ไม่ได้ใช้ (safeTitle, safeDesc) ลบทิ้งได้เลยครับ เพราะ onclick เราส่งแค่ ID แล้ว
        
        const timerId = `timer-${item.id}`;
        const endTime = item.end_time ? new Date(item.end_time).getTime() : 0;
        
        let soldOverlay = item.status === 'sold' ? `<div class="sold-overlay"><div class="sold-text">SOLD</div></div>` : "";
        
        const catMap = { 'it': 'ไอที', 'fashion': 'แฟชั่น', 'amulet': 'พระเครื่อง', 'home': 'ของใช้', 'other': 'อื่นๆ' };
        const catName = catMap[item.category] || 'อื่นๆ';
        const sellerName = item.seller_name || "ผู้ขาย";

        // --- Logic แสดงราคา (ปลอดภัยแล้ว) ---
        let priceDisplayHtml = "";
        const currentPrice = item.current_price || 0;
        const buyNowPrice = item.buy_now_price || 0;

        const safeCurrentPrice = (item.current_price ?? 0).toLocaleString();
        const safeBuyNowPrice = (item.buy_now_price ?? 0).toLocaleString();

        if (buyNowPrice > 0 && currentPrice >= buyNowPrice) {
            priceDisplayHtml = `<p class="card-text text-danger fw-bold mb-2 h5">฿${safeCurrentPrice} (เกินราคาซื้อสด)</p>`;
        } else if (item.current_price !== null && item.current_price !== undefined) {
            priceDisplayHtml = `<p class="card-text text-danger fw-bold mb-2 h5">฿${safeCurrentPrice}</p>`;
        } else if (item.buy_now_price) {
            priceDisplayHtml = `<p class="card-text text-success fw-bold mb-2 h5">สด ฿${safeBuyNowPrice}</p>`;
        } else {
            priceDisplayHtml = `<p class="card-text text-muted mb-2 small">รอราคาเปิด</p>`;
        }

        // ป้องกันชื่อสินค้าทำ HTML พังใน attribute alt
        const safeTitle = escapeHtml(item.title); 
        const safeImg = escapeHtml(item.image_url); 

        // ต่อ String ใส่ตัวแปรแทนการยัดเข้า DOM ทันที
        allCardsHtml += `
            <div class="col-6 col-md-4 col-lg-3">
                <div class="card h-100 cursor-pointer position-relative card-custom" onclick="openAuction('${item.id}')">
                    ${soldOverlay}
                    <div class="product-img-wrapper"> 
                        
                    <img src="${safeImg}" class="product-img-list" alt="${safeTitle}" onerror="this.src='https://via.placeholder.com/300?text=No+Image'">
                        <div class="position-absolute top-0 start-0 p-2">
                            <span class="badge bg-light text-dark shadow-sm opacity-75">${catName}</span>
                        </div>
                    </div>
                    <div class="card-body p-3">
                        <h6 class="card-title text-truncate fw-bold mb-1">${safeTitle}</h6>
                        ${priceDisplayHtml}
                        <div class="d-flex justify-content-between align-items-center mt-2">
                            <small class="text-secondary text-truncate" style="max-width: 80px;"><i class="bi bi-person"></i> ${escapeHtml(sellerName)}</small>
                            <div class="text-warning small fw-bold">
                                <i class="bi bi-clock"></i> 
                                <span id="${timerId}" class="card-timer" data-end-time="${endTime}">--:--</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
    });

    // ✅ อัปเดตหน้าจอทีเดียวตอนจบลูป (ช่วยให้เว็บลื่นขึ้นมาก)
    listContainer.innerHTML = allCardsHtml;
}

// ==========================================
// B. Dashboard (เรียก Service เพื่อคำนวณ)
// ==========================================

window.openDashboardModal = async function() {
    // 1. เช็ค Login
    if(!currentUser) 
        return Swal.fire({
                    icon: 'error',
                    title: 'เกิดข้อผิดพลาด',
                    text: 'กรุณาเข้าสู่ระบบ',
                    confirmButtonColor: '#ff6b6b'
                });
    
    // 2. เปิด Modal และแสดง Loading
    new bootstrap.Modal(document.getElementById('dashboardModal')).show();
    const mySellingContainer = document.getElementById('mySellingList');
    const myBiddingContainer = document.getElementById('myBiddingList');
    
    mySellingContainer.innerHTML = loadSpinner("กำลังโหลดรายการขาย...");
    myBiddingContainer.innerHTML = loadSpinner("กำลังโหลดรายการประมูล...");

    try {
        // 3. เรียกข้อมูลจาก Python Backend 🚀
        const data = await UserService.getDashboardData();
        
        // 4. Render: รายการที่ขาย (Selling)
        renderMySelling(data.selling, mySellingContainer);
        
        // 5. Render: รายการที่ประมูล (Bidding)
        renderMyBidding(data.bidding, myBiddingContainer);

    } catch (error) {
        console.error(error);
        mySellingContainer.innerHTML = `<p class="text-danger text-center py-3">เกิดข้อผิดพลาด: ${error.message}</p>`;
        myBiddingContainer.innerHTML = "";
    }
}

// --- Helper Functions สำหรับ Render HTML ---

function loadSpinner(text) {
    return `<div class="col-12 text-center py-5"><div class="spinner-border text-danger" role="status"></div><p class="text-secondary mt-3 small">${escapeHtml(text)}</p></div>`;
}

function renderMySelling(items, container) {
    container.innerHTML = "";
    if (items.length === 0) {
        container.innerHTML = "<p class='text-center w-100 small text-secondary py-3'>คุณยังไม่ได้ลงขายสินค้า</p>";
        return;
    }

    items.forEach(item => {
        const statusBadge = item.status === 'sold' ? '<span class="badge bg-success">ขายแล้ว</span>' : '<span class="badge bg-primary">กำลังขาย</span>';
        const price = item.current_price || item.buy_now_price || 0;
        
        container.innerHTML += `
            <div class="col-12 col-md-6">
                <div class="border p-2 rounded bg-white shadow-sm d-flex gap-3 align-items-center" onclick="openAuction('${item.id}', '${item.title}', ${price}, '${item.image_url}', '')" style="cursor:pointer">
                    <img src="${escapeHtml(item.image_url)}" style="width:60px; height:60px; object-fit:cover" class="rounded bg-light">
                    <div style="overflow:hidden" class="flex-grow-1">
                        <div class="text-truncate fw-bold text-dark">${escapeHtml(item.title)}</div>
                        <div class="d-flex justify-content-between align-items-center mt-1">
                            <span class="text-danger fw-bold">฿${price.toLocaleString()}</span>
                            ${statusBadge}
                        </div>
                    </div>
                </div>
            </div>`;
    });
}

function renderMyBidding(list, container) {
    container.innerHTML = "";
    if (list.length === 0) {
        container.innerHTML = "<p class='text-center w-100 small text-secondary py-3'>คุณยังไม่ได้ร่วมประมูลสินค้าใดๆ</p>";
        return;
    }

    list.forEach(data => {
        const item = data.item;
        const myRank = data.my_rank;
        const myMaxBid = data.my_max_bid;
        const isWinner = data.is_winner;

        let rankClass = "bg-light text-secondary";
        let rankText = "กำลังแข่ง";
        
        if (isWinner) { 
            rankClass = "bg-success text-white"; 
            rankText = "🏆 ชนะประมูล!"; 
        } else if (item.status === 'sold') {
            rankClass = "bg-secondary text-white";
            rankText = "❌ แพ้";
        } else if (myRank === 1) { 
            rankClass = "bg-warning text-dark"; 
            rankText = "🥇 ผู้นำสูงสุด"; 
        } else {
            rankText = "รองจ่าฝูง";
        }

        const currentP = item.current_price || item.buy_now_price || 0;

        container.innerHTML += `
            <div class="col-12 col-md-6">
                <div class="border p-2 rounded bg-white shadow-sm d-flex gap-3 align-items-center" onclick="openAuction('${item.id}', '${item.title}', ${currentP}, '${item.image_url}', '')" style="cursor:pointer">
                    <img src="${escapeHtml(item.image_url)}" style="width:70px; height:70px; object-fit:cover" class="rounded bg-light">
                    <div style="overflow:hidden" class="flex-grow-1">
                        <div class="text-truncate fw-bold text-dark mb-1">${escapeHtml(item.title)}</div>
                        <div class="d-flex justify-content-between align-items-center">
                            <div><span class="badge ${rankClass}">${rankText}</span></div>
                            <div class="text-end">
                                <div class="small text-secondary" style="font-size:0.7rem;">ราคาปัจจุบัน</div>
                                <div class="text-danger fw-bold">฿${currentP.toLocaleString()}</div>
                            </div>
                        </div>
                        <div class="d-flex justify-content-between align-items-center mt-2 border-top pt-1">
                            <span class="small text-muted" style="font-size:0.75rem;">เสนอไป: ฿${myMaxBid.toLocaleString()}</span>
                        </div>
                    </div>
                </div>
            </div>`;
    });
}

// ==========================================
// C. Load Products (ใช้ Service)
// ==========================================
function loadProducts() {
    const listContainer = document.getElementById('productList');
    if(!listContainer) return;
    
    // 🔥 เรียก Service
    AuctionService.subscribeAuctions((snapshot) => {
        allProducts = [];
        snapshot.forEach((doc) => {
            const data = doc.data();
            data.id = doc.id;
            
            const isSold = data.status === 'sold';
            const isExpired = data.end_time && new Date().getTime() > data.end_time;

            // โชว์เฉพาะที่ (ยังไม่ขาย และ ยังไม่หมดเวลา)
            if (!isSold && !isExpired) {
                allProducts.push(data);
            }
        });
        applyFilters();
    });
}
loadProducts();

// ==========================================
// D. Auth & User System (ใช้ Service)
// ==========================================
function generateRandomCode() { const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'; let result = ''; for (let i = 0; i < 13; i++) { result += chars.charAt(Math.floor(Math.random() * chars.length)); } return result; }

async function initSystem() { 
    try { 
        currentIp = await AuthService.getClientIp(); // ใช้ Service
    } catch (e) { } 
    
    // AuthService.loginAnonymous().catch((error) => console.error("Login Error:", error)); // ใช้ Service
}
initSystem();

window.logoutSystem = async function() { 
    Swal.fire({
        title: 'ออกจากระบบ?',
        text: "คุณต้องการ Log out ใช่หรือไม่",
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#ff6b6b', 
        cancelButtonColor: '#b2bec3',
        confirmButtonText: 'ใช่, ออกเลย',
        cancelButtonText: 'ยกเลิก'
    }).then(async (result) => {
        if (result.isConfirmed) {
            await AuthService.logout(); 
            window.location.reload();
        }
    }); 
}


AuthService.onUserChange(async (user) => {
    if (user) {
        currentUser = user;
        
        // จัดการปุ่ม UI ให้ถูกต้องทันที
        const btnLogin = document.getElementById('btnLogin'); 
        const btnLogout = document.getElementById('btnLogout');
        if (btnLogin && btnLogout) {
            if (user.is_anonymous) { 
                btnLogin.classList.remove('d-none'); 
                btnLogout.classList.add('d-none'); 
            } else { 
                btnLogin.classList.add('d-none'); 
                btnLogout.classList.remove('d-none'); 
            }
        }

        // ดึงข้อมูล Guest ใหม่
        const userSnap = await UserService.getUserProfile(user.id);
        
        // 🔍 เช็คของเก่าในเครื่อง
        const savedSecret = localStorage.getItem('my_guest_secret');
        
        // ถ้าเป็น Guest และข้อมูลในเครื่องไม่ตรงกับคนปัจจุบัน (แสดงว่าเรา Logout ออกมาแล้วได้ร่างใหม่)
        const isNewIdentity = user.is_anonymous && savedSecret && 
                             (!userSnap.exists() || userSnap.data()?.secret_code !== savedSecret);

        if (isNewIdentity) {
            // 🛑 หยุด! เจอเซฟเก่า อย่าเพิ่งใช้ร่างใหม่
            console.log("Found old secret:", savedSecret);
            
            Swal.fire({
                title: 'พบข้อมูลเดิมในเครื่อง!',
                text: 'คุณเคยใช้งานบัญชี Guest ไว้ ต้องการกู้คืนข้อมูลเดิมหรือไม่?',
                icon: 'info',
                showCancelButton: true,
                confirmButtonColor: '#1dd1a1',
                confirmButtonText: 'ใช่! กู้คืนข้อมูลเดิม',
                cancelButtonText: 'ไม่ (เริ่มใหม่ทั้งหมด)'
            }).then(async (result) => {
                if (result.isConfirmed) {
                    try {
                        // ส่งร่างใหม่ (user) ไปสวมรอยเป็นร่างเก่า (savedSecret)
                        const oldName = await UserService.recoverAccount(user, savedSecret);
                        
                        // กู้สำเร็จ! อัปเดตรหัสลับในเครื่องให้เป็นรหัสของ User ปัจจุบัน (เพราะย้ายข้อมูลมาแล้ว)
                        // หมายเหตุ: การ Recover ใน Backend เราย้ายข้อมูลมาหา ID ใหม่ ดังนั้น Secret จะเปลี่ยนตาม ID ใหม่
                        localStorage.setItem('my_guest_secret', userSnap.data()?.secret_code || savedSecret); // *แก้ Logic Backend ให้ส่ง Secret ใหม่กลับมาจะดีมาก*
                        
                        Swal.fire('ยินดีต้อนรับกลับ', `คุณ ${oldName}`, 'success').then(()=> window.location.reload());
                    } catch (e) {
                        Swal.fire('กู้คืนไม่สำเร็จ', 'ข้อมูลเก่าอาจถูกลบไปแล้ว', 'error');
                        localStorage.removeItem('my_guest_secret'); // ลบของเสียทิ้ง
                    }
                } else {
                    // เลือกเริ่มใหม่ -> ลบความทรงจำเก่าทิ้ง แล้วจำคนใหม่แทน
                    localStorage.removeItem('my_guest_secret');
                    // บังคับ Save คนใหม่ทันที
                    if(userSnap.exists()) localStorage.setItem('my_guest_secret', userSnap.data().secret_code);
                    window.location.reload();
                }
            });
        } 
        
        // โหลดข้อมูลตามปกติ
        if (userSnap.exists()) {
            setupUserProfile(userSnap.data());
            // Realtime Update Profile
            UserService.subscribeProfile(user.id, (docSnap) => { 
                if (docSnap.exists()) setupUserProfile(docSnap.data()); 
            });
        } else {
             // สร้าง Guest ใหม่ (ถ้ายังไม่มีใน DB)
             setupNewGuestProfile(user);
        }

    } else {
        // ถ้าไม่มี User (เพิ่งเข้าเว็บ) -> Login Guest
        AuthService.loginAnonymous().catch(console.error);
    }
});
// ฟังก์ชันแยกออกมาเพื่อความสะอาด (สร้าง Profile ใหม่)
async function setupNewGuestProfile(user) {
    if (!user || !user.id) return; // 🛡️ กันระเบิดถ้า user ไม่มี

    console.log("✅ Guest Profile handled by Database Trigger for:", user.id);
    
    // Logic การสร้างรหัสลับ (Secret Code) เก็บลงเครื่อง
    const defaultName = "Guest_" + user.id.slice(0, 4);
    
    // ⚠️ เราจะไม่เรียก UserService.createProfile แล้ว เพราะ SQL ทำให้อัตโนมัติ
    // แต่เราจะ Subscribe รอข้อมูลมาแทน
    
    UserService.subscribeProfile(user.id, (docSnap) => { 
        if (docSnap.exists()) {
            setupUserProfile(docSnap.data()); 
        }
    }); 
}

function setupUserProfile(data) { 
    // เก็บข้อมูลลง Cache
    userProfileCache = data; 
    isBanned = data.is_banned; 

    // อัปเดตชื่อบน Navbar
    updateUIName(data.username); 

    // ถ้าเปิด Modal โปรไฟล์อยู่ ให้เติมข้อมูลลงฟอร์ม
    if(document.getElementById('profileSecretCode')) { 
        document.getElementById('profileSecretCode').value = data.secret_code || ""; 
        document.getElementById('profileEmail').value = data.contact_email || ""; 
    }

    // ✅ แก้ไขแล้ว: currentuser -> currentUser (ตัว U ใหญ่)
    // Logic: แอบจด "รหัสลับ" ใส่เครื่องไว้ ถ้าเป็น Guest
    if (currentUser && currentUser.is_anonymous && data.secret_code) {
        const oldSecret = localStorage.getItem('my_guest_secret');
        
        // ถ้าไม่มีของเก่า หรือ ของเก่าตรงกับคนปัจจุบัน -> บันทึกได้
        if (!oldSecret || oldSecret === data.secret_code) {
             localStorage.setItem('my_guest_secret', data.secret_code);
        }
    }

    // ส่วนจัดการปุ่ม Link Account (ใส่ ? ป้องกัน Error ถ้า providerData เป็น null)
    const isLinked = currentUser?.providerData?.some(p => p.providerId === 'password'); 
    const linkSection = document.getElementById('linkAccountSection'); 
    
    if(isLinked && linkSection) { 
        linkSection.innerHTML = `<div class="text-success text-center py-2"><i class="bi bi-check-circle-fill"></i> บัญชีนี้ผูกกับอีเมลแล้ว</div>`; 
    } 

    // ถ้าโดนแบน ให้ล้างหน้าจอทิ้งเลย
    if(isBanned) {
        document.body.innerHTML = "<div class='vh-100 d-flex justify-content-center align-items-center bg-danger'><h1 class='text-white'>🚫 BANNED</h1></div>"; 
    }
}

function updateUIName(name) { 
    const el = document.getElementById('navUsername'); 
    if(el) el.innerText = name; 
}

// ==========================================
// Timer Logic (ทำงานถูกต้องแล้วครับ)
// ==========================================
setInterval(() => { 
    const modal = document.getElementById('auctionModal'); 
    // อัปเดตเวลาใน Modal (ถ้าเปิดอยู่)
    if (currentProductEndTime && modal && modal.classList.contains('show')) { 
        updateTimerUI(currentProductEndTime, 'modalTimer', 'modalTimerBadge', true); 
    } 
    // อัปเดตเวลาในการ์ดหน้าแรก
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

    // กรณีหมดเวลา
    if (distance < 0) { 
        textEl.innerText = "ปิดประมูลแล้ว"; 
        
        if(badgeEl) { 
            badgeEl.className = "badge bg-secondary"; 
            // แก้สีข้อความในการ์ดให้เป็นสีแดงเพื่อเน้น
            if(badgeEl.parentElement.classList.contains('text-warning')) { 
                badgeEl.parentElement.className = "text-danger small fw-bold"; 
            } 
        } 
        
        // ถ้าเป็น Modal ให้ซ่อนปุ่มบิด/ซื้อ
        if(isModal) { 
            document.getElementById('bidControlSection').classList.add('d-none'); 
            document.getElementById('buyNowSection').classList.add('d-none'); 
            
            // ถ้ายังไม่ขึ้น Sold ให้ขึ้นว่าปิดประมูล
            if(document.getElementById('soldBadge').classList.contains('d-none')) { 
                document.getElementById('auctionEndedMsg').classList.remove('d-none'); 
            } else { 
                document.getElementById('auctionEndedMsg').classList.add('d-none'); 
            } 
        } 
    } else { 
        // กรณีเวลายังเดินอยู่
        const days = Math.floor(distance / (1000 * 60 * 60 * 24)); 
        const hours = Math.floor((distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)); 
        const minutes = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60)); 
        const seconds = Math.floor((distance % (1000 * 60)) / 1000); 
        
        let timeString = ""; 
        if(days > 0) timeString += `${days}วัน `; 
        timeString += `${hours}ชม. ${minutes}น. ${seconds}วิ.`; 
        
        textEl.innerText = timeString; 
        
        // ถ้าเหลือเวลา < 5 นาที ให้กระพริบเตือน (Animation Flash)
        if(distance < 5 * 60 * 1000 && badgeEl) { 
            badgeEl.className = "badge bg-danger animate__animated animate__flash"; 
        } 
    } 
}
// ==========================================
// F. Modal Logic (ใช้ Service)
// ==========================================
window.openAuction = function(id, title, price, img, desc) {
    // 1. ลองหาข้อมูลสินค้าจาก allProducts ก่อน (กรณีคลิกหน้าแรกแล้วส่งมาแค่ ID)
    const itemFromCache = allProducts.find(p => p.id === id);

    // 2. คำนวณค่าที่ปลอดภัย (ถ้าไม่มีใน argument ให้เอาจาก cache, ถ้าไม่มีอีกให้เอาค่า default)
    const safeTitle = title || itemFromCache?.title || "กำลังโหลด...";
    // ✅ แก้ปัญหา 404: ถ้าไม่มีรูป ให้ใช้ Placeholder
    const safeImg = img || itemFromCache?.image_url || "https://via.placeholder.com/300?text=No+Image"; 
    const safeDesc = desc || itemFromCache?.description || "";
    
    // 3. เซ็ตค่าลง Modal (ทำแค่รอบเดียวพอ!)
    currentProductId = id;
    
    document.getElementById('modalTitle').innerText = safeTitle;
    document.getElementById('modalImage').src = safeImg; 
    document.getElementById('modalDesc').innerText = escapeHtml(safeDesc);

    // 4. รีเซ็ต UI ส่วนอื่นๆ
    document.getElementById('bidInput').value = "";
    document.getElementById('bidHistoryList').innerHTML = "<div class='text-center small mt-4 text-secondary'>กำลังโหลดประวัติ...</div>";
    
    document.getElementById('bidControlSection').classList.add('d-none');
    document.getElementById('buyNowSection').classList.add('d-none');
    document.getElementById('auctionEndedMsg').classList.add('d-none');
    document.getElementById('soldMsg').classList.add('d-none');
    document.getElementById('soldBadge').classList.add('d-none');
    
    document.getElementById('modalSellerName').innerText = "กำลังโหลด...";
    document.getElementById('modalEmailLink').classList.add('d-none');
    document.getElementById('modalEditBtn').classList.add('d-none');
    document.getElementById('modalCategoryBadge').innerText = "หมวดหมู่";

    if (unsubscribeProduct) unsubscribeProduct();
    if (unsubscribeBids) unsubscribeBids();

    // 🔥 เรียก Service: Subscribe รายละเอียดสินค้า
    unsubscribeProduct = AuctionService.subscribeAuctionDetail(id, (docSnapshot) => {
        if (docSnapshot.exists()) {
            const data = docSnapshot.data();
            currentSellerId = data.seller_id;

            // อัปเดตข้อมูล Realtime ทับอีกทีเมื่อโหลดเสร็จ
            const modalPrice = document.getElementById('modalPrice');
            if (data.current_price !== null && data.current_price !== undefined) {
                modalPrice.innerText = `฿${data.current_price.toLocaleString()}`;
                modalPrice.className = "display-6 fw-bold text-danger";
            } else if (data.buy_now_price) {
                modalPrice.innerText = `฿${data.buy_now_price.toLocaleString()}`;
                modalPrice.className = "display-6 fw-bold text-success";
            } else {
                modalPrice.innerText = "-";
            }

            // อัปเดตชื่อและรูปอีกครั้ง (เผื่อมีการแก้ไขจากหลังบ้าน)
            document.getElementById('modalTitle').innerText = data.title;
            if(data.image_url) document.getElementById('modalImage').src = data.image_url;
            document.getElementById('modalDesc').innerText = data.description;

            if(data.end_time) currentProductEndTime = new Date(data.end_time).getTime();
            
            if(data.contact_email) {
                document.getElementById('modalEmailLink').href = `mailto:${data.contact_email}`;
                document.getElementById('modalEmailLink').classList.remove('d-none');
            }
            
            const catMap = { 'it': 'ไอที', 'fashion': 'แฟชั่น', 'amulet': 'พระเครื่อง', 'home': 'ของใช้', 'other': 'อื่นๆ' };
            document.getElementById('modalCategoryBadge').innerText = catMap[data.category] || 'สินค้าทั่วไป';

            // Seller Name Logic
            if (data.seller_name) {
                document.getElementById('modalSellerName').innerText = data.seller_name;
            } else if(data.seller_id) {
                UserService.getUserProfile(data.seller_id).then(uSnap => {
                    if(uSnap.exists()) document.getElementById('modalSellerName').innerText = uSnap.data().username;
                });
            }

            // ปุ่มแก้ไข
            if (currentUser && currentUser.id === data.seller_id && data.status !== 'sold') {
                document.getElementById('modalEditBtn').classList.remove('d-none');
            } else {
                document.getElementById('modalEditBtn').classList.add('d-none');
            }

            // สถานะ Sold / Buy Now
            if (data.status === 'sold') {
                document.getElementById('soldBadge').classList.remove('d-none');
                document.getElementById('soldMsg').classList.remove('d-none');
                currentProductEndTime = 0; 
            } else {
                if (data.buy_now_price && data.buy_now_price > 0) {
                    document.getElementById('buyNowSection').classList.remove('d-none');
                    document.getElementById('buyNowPriceDisplay').innerText = `฿${data.buy_now_price.toLocaleString()}`;
                }
                if (data.current_price !== null && data.current_price !== undefined) {
                    document.getElementById('bidControlSection').classList.remove('d-none');
                }
            }
        }
    });

    // 🔥 เรียก Service: Subscribe ประวัติการบิด
    unsubscribeBids = AuctionService.subscribeBids(id, (snapshot) => {
        const historyList = document.getElementById('bidHistoryList');
        if(document.getElementById('bidCount')) document.getElementById('bidCount').innerText = snapshot.size;
        
        historyList.innerHTML = "";
        if (snapshot.empty) {
            historyList.innerHTML = "<div class='text-center text-secondary small mt-2'>ยังไม่มีข้อเสนอ<br>เป็นคนแรกสิ!</div>";
        } else {
            snapshot.forEach((doc) => {
                const bid = doc.data();
                // แปลง timestamp ของ supabase
                const bidTime = bid.created_at ? new Date(bid.created_at) : new Date();
                const timeStr = bidTime.toLocaleTimeString('th-TH', {hour:'2-digit', minute:'2-digit'});
                
                // หาชื่อคนบิด (ถ้าไม่มีใน bid object ให้หาจาก profile)
                let bidderName = "Unknown";
                if (bid.profiles && bid.profiles.username) {
                    bidderName = bid.profiles.username;
                } else if (bid.bidder_name) {
                    bidderName = bid.bidder_name;
                }

                const html = `
                    <div class="d-flex justify-content-between border-bottom py-2 px-2 align-items-center">
                        <div class="d-flex align-items-center gap-2">
                            <i class="bi bi-person-circle text-secondary"></i>
                            <div>
                                <div class="text-dark fw-bold small">${escapeHtml(bidderName)}</div>
                                <small class="text-secondary" style="font-size: 0.65rem;">${escapeHtml(timeStr)}</small>
                            </div>
                        </div>
                        <div class="text-success fw-bold">฿${Number(bid.amount).toLocaleString()}</div>
                    </div>
                `;
                historyList.innerHTML += html;
            });
        }
    });

    new bootstrap.Modal(document.getElementById('auctionModal')).show();
}

// ==========================================
// G. Add & Edit Item (ใช้ Service)
// ==========================================

const addForm = document.getElementById('addItemForm');
if(addForm) {
    addForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        if(checkBan()) return;
        
        const title = document.getElementById('inpTitle').value;
        const priceVal = document.getElementById('inpPrice').value;
        const buyNowVal = document.getElementById('inpBuyNowPrice').value;
        const bidIncrementVal = document.getElementById('inpBidIncrement').value;
        const bidIncrement = bidIncrementVal ? Number(bidIncrementVal) : 20;
        
        const price = priceVal !== "" ? Number(priceVal) : null;
        const buyNowPrice = buyNowVal !== "" ? Number(buyNowVal) : null;
        
        if (price === null && buyNowPrice === null) {
            return Swal.fire({
                        icon: 'error',
                        title: 'เกิดข้อผิดพลาด',
                        text: 'กรุณาระบุ ราคาเริ่มต้น หรือ ราคาขายสด อย่างน้อย 1 อย่าง',
                        confirmButtonColor: '#ff6b6b'
                    });
        }

        const email = document.getElementById('inpEmail').value.trim();
        const fileInput = document.getElementById('inpFile');
        const endTimeInput = document.getElementById('inpEndTime').value;
        
        if (!email || !endTimeInput || fileInput.files.length === 0) 
            return Swal.fire({
                        icon: 'error',
                        title: 'เกิดข้อผิดพลาด',
                        text: 'กรอกข้อมูลให้ครบ',
                        confirmButtonColor: '#ff6b6b'
                    });
        const endTimeMs = new Date(endTimeInput).getTime();
        if (endTimeMs <= new Date().getTime()) 
            return Swal.fire({
                        icon: 'error',
                        title: 'เกิดข้อผิดพลาด',
                        text: '❌ เวลาปิดประมูลต้องเป็นอนาคต',
                        confirmButtonColor: '#ff6b6b'
                    });

        try {
            toggleLoading(true);
           const file = fileInput.files[0];
    
            // 1. Upload รูป
            const imageUrl = await StorageService.uploadImage(file);

            // 2. สร้างสินค้า (ส่งแค่ข้อมูลที่ User กรอก + ค่าที่คำนวณได้)
            // ⚠️ ไม่ต้องแปลงชื่อตัวแปรให้ตรง DB ตรงนี้ เดี๋ยวให้ api.js ทำให้
            await AuctionService.createAuction({
                title: title, 
                category: document.getElementById('inpCategory').value || "other", 
                description: document.getElementById('inpDesc').value, 
                
                // ราคา
                current_price: price, 
                buy_now_price: buyNowPrice,
                bid_increment: bidIncrement, // ส่งชื่อนี้ไป เดี๋ยว api.js แปลงเป็น min_bid_increment เอง
                
                // ข้อมูลติดต่อ
                contact_email: email,
                image_url: imageUrl, 
                
                // ผู้ขาย
                seller_id: currentUser ? currentUser.id : "guest", 
                // seller_name ไม่ต้องส่งก็ได้ (เพราะ DB ไม่เก็บ) หรือจะส่งไปแล้วให้ api.js ลบออกก็ได้
                
                // เวลา (ส่งเป็น ms ไปเลย ง่ายกว่า)
                end_time: endTimeMs, // ✅ แก้จาก data.end_time เป็น endTimeMs
                
                // start_time ไม่ต้องส่ง เดี๋ยว api.js สร้างเวลาปัจจุบันให้
                status: 'active'
            });

            
            
            toggleLoading(false); 
            Swal.fire({
                icon: 'success',
                title: 'สำเร็จ!',
                text: 'ลงสินค้าเรียบร้อย',
                confirmButtonColor: '#1dd1a1'
            }); 
            location.reload(); 
        } catch (error) { 
            toggleLoading(false); 
            Swal.fire({
                icon: 'error',
                title: 'เกิดข้อผิดพลาด',
                text: error.message,
                confirmButtonColor: '#ff6b6b'
            });("Error: " + error.message); 
        }
    });
}

const editForm = document.getElementById('editItemForm');
if(editForm) {
    editForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const endTimeInput = document.getElementById('editEndTime').value;
        const endTimeMs = new Date(endTimeInput).getTime();
        if (endTimeMs <= new Date().getTime()) 
            return Swal.fire({
                        icon: 'error',
                        title: 'เกิดข้อผิดพลาด',
                        text: '❌ เวลาปิดประมูลต้องเป็นอนาคต',
                        confirmButtonColor: '#ff6b6b'
                    });
        
        const pid = document.getElementById('editProductId').value;
        const fileInput = document.getElementById('editFile');
        const buyNowVal = document.getElementById('editBuyNowPrice').value;
        const buyNowPrice = buyNowVal ? Number(buyNowVal) : null;

        try {
        toggleLoading(true);
        let imageUrl = document.getElementById('currentImageUrl').value; 
        
        // เช็คว่ามีการอัปโหลดรูปใหม่ไหม
        if (fileInput.files.length > 0) {
            // 🔥 เรียก Service: Upload
            imageUrl = await StorageService.uploadImage(fileInput.files[0]);
        }

        // 🔥 เรียก Service: Update Auction
        await AuctionService.updateAuction(pid, {
            title: document.getElementById('editTitle').value, 
            description: document.getElementById('editDesc').value,
            category: document.getElementById('editCategory').value || "other",
            buy_now_price: buyNowPrice,
            image_url: imageUrl, 
            contact_email: document.getElementById('editEmail').value, 
            
            // ✅ แก้ตรงนี้: เปลี่ยน key เป็น end_time_ms เพื่อให้ api.js รู้ว่าเป็นตัวเลข
            end_time: endTimeMs
            });
            toggleLoading(false); 
                Swal.fire({
                    icon: 'success',
                    title: 'สำเร็จ!',
                    text: 'แก้ไขเรียบร้อย!',
                    confirmButtonColor: '#1dd1a1' // สีธีมเรา
                });
            bootstrap.Modal.getInstance(document.getElementById('editItemModal')).hide(); 
            location.reload();
            
        }   catch(e) { toggleLoading(false); 
                Swal.fire({
                    icon: 'error',
                    title: 'เกิดข้อผิดพลาด',
                    text: e.message,
                    confirmButtonColor: '#ff6b6b'
                });}
    });
}

window.openEditModal = async function() {
    if(!currentProductId) return;
    bootstrap.Modal.getInstance(document.getElementById('auctionModal')).hide();
    toggleLoading(true);
    
    // 🔥 เรียก Service: Get Single Auction
    const docSnap = await AuctionService.getAuctionById(currentProductId);
    
    if(docSnap.exists()) {
        const data = docSnap.data();
            // ✅ เพิ่ม: เช็คว่าเป็นเจ้าของไหม
        if (currentUser.id !== data.seller_id) {
            toggleLoading(false);
            return Swal.fire({
                icon: 'error',
                title: 'ห้ามแก้ไข',
                text: 'คุณไม่ใช่เจ้าของสินค้านี้',
                confirmButtonColor: '#ff6b6b'
            });
        }
        document.getElementById('editProductId').value = currentProductId;
        document.getElementById('editTitle').value = data.title;
        document.getElementById('editDesc').value = data.description;
        document.getElementById('editCategory').value = data.category || "other"; 
        document.getElementById('editPrice').value = data.current_price; 
        document.getElementById('editBuyNowPrice').value = data.buy_now_price || "";
        document.getElementById('currentImageUrl').value = data.image_url;
        
        const safeImageUrl = data.image_url || ""; // ถ้าไม่มีให้เป็นค่าว่าง
        document.getElementById('currentImageUrl').value = safeImageUrl;

        const imgDisplay = document.getElementById('editCurrentImgDisplay'); 
        if (imgDisplay) {
            // ถ้า URL ว่าง ให้ใส่รูป Placeholder แทน undefined
            imgDisplay.src = safeImageUrl || 'https://via.placeholder.com/150?text=No+Image';
        }
        document.getElementById('editFile').value = "";
        document.getElementById('editEmail').value = data.contact_email || "";
        if(data.end_time) {
            const date = new Date(data.end_time);
            const tzOffset = date.getTimezoneOffset() * 60000; 
            const localISOTime = (new Date(date - tzOffset)).toISOString().slice(0, 16);
            document.getElementById('editEndTime').value = localISOTime;
        }
        toggleLoading(false);
        new bootstrap.Modal(document.getElementById('editItemModal')).show();
    }
}

// ==========================================
// Actions: Bid & Buy Now (ใช้ Service)
// ==========================================
function toggleLoading(show) { 
    const loader = document.getElementById('loading'); 
    if (loader) loader.style.display = show ? 'flex' : 'none'; 
}

window.placeBid = async function() {
    if(checkBan()) return;
    if(document.getElementById('navUsername').innerText.includes("Guest (IP ซ้ำ)")) 
        return Swal.fire({
                    icon: 'error',
                    title: 'เกิดข้อผิดพลาด',
                    text: 'กรุณากู้คืนบัญชีเดิมก่อน',
                    confirmButtonColor: '#ff6b6b'   
                });
    if(currentUser && currentSellerId === currentUser.id) 
        return Swal.fire({
                    icon: 'error',
                    title: 'เกิดข้อผิดพลาด',
                    text: 'คุณประมูลสินค้าตัวเองไม่ได้!',
                    confirmButtonColor: '#ff6b6b'   
                });
    const bidInput = document.getElementById('bidInput');
    const bidAmount = Number(bidInput.value);
    if(!bidAmount || bidAmount <= 0) 
        return Swal.fire({
                    icon: 'error',
                    title: 'เกิดข้อผิดพลาด',
                    text: 'กรุณาใส่ราคา',
                    confirmButtonColor: '#ff6b6b'   
                });
    try {
        const productSnap = await AuctionService.getAuctionById(currentProductId);
        if (productSnap.exists()) {
            const data = productSnap.data();
            const now = new Date().getTime();
            if (data.status === 'sold') 
                return Swal.fire({
                    icon: 'error',
                    title: 'อุ๊ปส์...',
                    text: 'สินค้านี้ขายแล้ว!',
                    confirmButtonColor: '#ff6b6b'   
                });
            if (data.end_time && now > data.end_time) 
                return Swal.fire({
                    icon: 'error',
                    title: 'อุ๊ปส์...',
                    text: 'หมดเวลาแล้ว!',
                    confirmButtonColor: '#ff6b6b'   
                });
            
            const currentP = data.current_price || 0;
            const minIncrement = data.bid_increment || 20;
            let minAllowedPrice = currentP + minIncrement;
            if (currentP === 0) minAllowedPrice = data.current_price;

            if (bidAmount < (currentP + minIncrement)) {
                return Swal.fire({
                            icon: 'error',
                            title: 'อุ๊ปส์...',
                            text: `ต้องเสนอราคาเพิ่มขึ้นอย่างน้อย ฿${minIncrement.toLocaleString()} (ขั้นต่ำต้องใส่ ฿${(currentP + minIncrement).toLocaleString()})`, 
                            confirmButtonColor: '#ff6b6b'
                        });
            }
            if (bidAmount <= currentP) 
                return Swal.fire({
                            icon: 'error',
                            title: 'อุ๊ปส์...',
                            text: `ต้องใส่ราคามากกว่า ฿${currentP.toLocaleString()}`,
                            confirmButtonColor: '#ff6b6b'
                        });

            const myName = document.getElementById('navUsername').innerText;
            
            // 🔥 เรียก Service: Place Bid
            await AuctionService.placeBid(currentProductId, {
                amount: bidAmount, 
                bidder_id: currentUser.id, 
                bidder_name: myName
            }, data);

            bidInput.value = "";
        }
    } catch (error) { Swal.fire({
                        icon: 'error',
                        title: 'อุ๊ปส์...',
                        text: error.message, 
                        confirmButtonColor: '#ff6b6b'
                    });}
}

window.buyNow = async function() {
    if(checkBan()) return;
    if(document.getElementById('navUsername').innerText.includes("Guest (IP ซ้ำ)")) 
        return Swal.fire({
                    icon: 'error',
                    title: 'เกิดข้อผิดพลาด',
                    text: "กรุณากู้คืนบัญชีเดิมก่อน", 
                    confirmButtonColor: '#ff6b6b'
                });
    if(currentUser && currentSellerId === currentUser.id) 
        return  Swal.fire({
                    icon: 'error',
                    title: 'อุ๊ปส์...',
                    text: "คุณซื้อสินค้าตัวเองไม่ได้!", 
                    confirmButtonColor: '#ff6b6b'
                });
    Swal.fire({
        title: 'ยืนยันการซื้อสด ?',
        text: "คุณต้องการซื้อสด ใช่หรือไม่",
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#b2bec3', 
        cancelButtonColor: '#ff6b6b',
        confirmButtonText: 'ใช่',
        cancelButtonText: 'ไม่'
    });
    try {
        const productSnap = await AuctionService.getAuctionById(currentProductId);
        if (productSnap.exists()) {
            const data = productSnap.data();
            const currentP = data.current_price || 0;
            if (data.buy_now_price && currentP >= data.buy_now_price) {
                return Swal.fire({
                    icon: 'error',
                    title: 'อุ๊ปส์...',
                    text: "ราคาประมูลปัจจุบันสูงกว่าราคาขายสดแล้ว", 
                    confirmButtonColor: '#ff6b6b'
                });
            }
            if (data.status === 'sold') 
                return Swal.fire({
                    icon: 'error',
                    title: 'อุ๊ปส์...',
                    text: "เสียใจด้วย มีคนซื้อตัดหน้าไปแล้ว!", 
                    confirmButtonColor: '#ff6b6b'
                });
            
            const myName = document.getElementById('navUsername').innerText;
            
            // 🔥 เรียก Service: Buy Now
            await AuctionService.buyNow(currentProductId, {
                amount: data.buy_now_price,
                winner_id: currentUser.id,
                bidder_name: myName
            });
            
            Swal.fire({
                icon: 'success',
                title: 'เรียบร้อย!',
                text: ' ซื้อสินค้าสำเร็จ! ยินดีด้วย 🎉🎉',
                confirmButtonColor: '#1dd1a1',
                confirmButtonText: 'ตกลง'
            });
        }
    } catch (error) { Swal.fire({
                            icon: 'error',
                            title: 'อุ๊ปส์...',
                            text: error.message,
                            confirmButtonColor: '#ff6b6b'
                        });}
}

window.openAddModal = function() {
    if(checkBan()) return;
    if(document.getElementById('navUsername').innerText.includes("Guest (IP ซ้ำ)")) 
        return Swal.fire({
                    icon: 'error',
                    title: 'อุ๊ปส์...',
                    text: 'กรุณากู้คืนบัญชีเดิมก่อนใช้งาน',
                    confirmButtonColor: '#ff6b6b'
                });
    document.getElementById('addItemForm').reset();
    setupProfileCheckbox('chkProfileEmail', userProfileCache.contact_email);
    if(userProfileCache.contact_email) document.getElementById('chkProfileEmail').click();
    new bootstrap.Modal(document.getElementById('addItemModal')).show();
}

function setupProfileCheckbox(chkId, dataValue) { const chk = document.getElementById(chkId); if (!dataValue) { chk.disabled = true; chk.parentElement.querySelector('label').innerText += " (ไม่มี)"; } else { chk.disabled = false; let label = chk.parentElement.querySelector('label').innerText; chk.parentElement.querySelector('label').innerText = label.replace(" (ไม่มี)", ""); } }
window.toggleContactInput = function(chkId, inputId, dataKey) { const isChecked = document.getElementById(chkId).checked; const inputEl = document.getElementById(inputId); if (isChecked) { inputEl.value = userProfileCache[dataKey] || ""; inputEl.readOnly = true; inputEl.classList.add('bg-secondary', 'text-white'); } else { inputEl.value = ""; inputEl.readOnly = false; inputEl.classList.remove('bg-secondary', 'text-white'); } }
window.openProfileModal = function() { if(!currentUser) return; document.getElementById('profileNameInput').value = document.getElementById('navUsername').innerText; new bootstrap.Modal(document.getElementById('profileModal')).show(); }

window.updateUserProfile = async function() { 
    const newName = document.getElementById('profileNameInput').value; 
    if(newName && currentUser) { 
        toggleLoading(true); 
        // 🔥 เรียก Service
        await UserService.updateProfile(currentUser.id, { 
            username: newName, 
            contact_email: document.getElementById('profileEmail').value 
        }); 
        updateUIName(newName);
        if(userProfileCache) userProfileCache.username = newName;
        
        toggleLoading(false); 
        Swal.fire({
            icon: 'success',
            title: 'เรียบร้อย!',
            text: 'บันทึกข้อมูลเรียบร้อย🎉',
            confirmButtonColor: '#1dd1a1', // สีเขียวมิ้นต์ตามธีมเว็บคุณ
            confirmButtonText: 'ตกลง'
        });
        bootstrap.Modal.getInstance(document.getElementById('profileModal')).hide(); 
    } 
}

window.linkAccount = async function() { 
    const email = document.getElementById('linkEmail').value.trim(); 
    const password = document.getElementById('linkPassword').value; 
    if(!email || password.length < 6) 
        return Swal.fire({
                    icon: 'error',
                    title: 'อุ๊ปส์...',
                    text: 'กรอกอีเมลและรหัสผ่าน (6 ตัวขึ้นไป)',
                    confirmButtonColor: '#ff6b6b'
                }); 
    try { 
        toggleLoading(true); 
        // 🔥 เรียก Service
        await AuthService.linkEmailAccount(currentUser, email, password);
        const currentName = document.getElementById('navUsername').innerText; // ดึงชื่อปัจจุบันมาด้วย

        await UserService.updateProfile(currentUser.id, { 
            username: currentName, // <--- ต้องส่งอันนี้ไปด้วย เพราะ Backend บังคับ
            contact_email: email 
        });
        toggleLoading(false); 
        Swal.fire({
            icon: 'success',
            title: 'เรียบร้อย ✅',
            text: 'ผูกบัญชีสำเร็จ! 🎉',
            confirmButtonColor: '#1dd1a1', // สีเขียวมิ้นต์ตามธีมเว็บคุณ
            confirmButtonText: 'ตกลง'
        });(" "); document.getElementById('linkAccountSection').innerHTML = `<div class="text-success text-center py-2"><i class="bi bi-check-circle-fill"></i> บัญชีนี้ผูกกับอีเมลแล้ว</div>`; 
    } catch (error) { toggleLoading(false); 
        Swal.fire({
            icon: 'error',
            title: 'อุ๊ปส์...',
            text: error.message,
            confirmButtonColor: '#ff6b6b'
        });} 
}

window.copySecret = function() { 
    const copyText = document.getElementById("profileSecretCode"); 
    copyText.select(); 
    navigator.clipboard.writeText(copyText.value); 
    Swal.fire({
            icon: 'success',
            title: 'เรียบร้อย!',
            text: 'คัดลอกรหัสลับแล้ว',
            confirmButtonColor: '#1dd1a1', 
            confirmButtonText: 'ตกลง'
        });
}
window.openRecoverModal = function() {
     new bootstrap.Modal(document.getElementById('recoverModal')).show();
    }

window.recoverAccount = async function() { 
    const secretCode = document.getElementById('recoverSecretCode').value.trim(); 
    if(!secretCode) 
        return  Swal.fire({
                    icon: 'error',
                    title: 'อุ๊ปส์...',
                    text: 'กรุณากรอกรหัสลับ', 
                    confirmButtonColor: '#ff6b6b'
                }); 
    try { 
        toggleLoading(true); 
        // 🔥 เรียก Service (รวม logic ย้ายข้อมูลไว้ใน api.js แล้ว)
        const oldName = await UserService.recoverAccount(currentUser, secretCode);
        toggleLoading(false); 
        Swal.fire({
            icon: 'success',
            title: 'ย้ายสำเร็จ!',
            text: `ยินดีต้อนรับ ${oldName}🎉`,
            confirmButtonColor: '#1dd1a1',
            confirmButtonText: 'ตกลง'
        }); location.reload();

    } catch (error) { toggleLoading(false); 
        Swal.fire({
            icon: 'error',
            title: 'อุ๊ปส์...',
            text: error.message,
            confirmButtonColor: '#ff6b6b'
        }); } 
}

function checkBan() { 
    if(isBanned) { 
        Swal.fire({
            icon: 'error',
            title: 'อุ๊ปส์...',
            text: 'คุณถูกระงับการใช้งาน',
            confirmButtonColor: '#ff6b6b'
        }); 
        return true; } 
        return false; }

// ✅ เช็ค URL ว่ามีการส่งรหัสสินค้ามาไหม ถ้ามีให้เปิด Modal ทันที
document.addEventListener("DOMContentLoaded", async () => {
    const urlParams = new URLSearchParams(window.location.search);
    const sharedItemId = urlParams.get('item_id');

    if (sharedItemId) {
        // รอสักนิดให้ระบบโหลดพื้นฐานเสร็จ
        setTimeout(async () => {
            const docSnap = await AuctionService.getAuctionById(sharedItemId);
            if (docSnap.exists()) {
                const item = docSnap.data();
                const price = item.current_price || item.buy_now_price || 0;
                // เปิด Modal สินค้า
                openAuction(sharedItemId, item.title, price, item.image_url, item.description);
            }
        }, 1000);
    }
});        


// ฟังก์ชันสำหรับกดปุ่ม "แชร์" ใน Modal สินค้า
window.shareAuction = function() {
    if (!currentProductId) return;

    const backendUrl = "https://auction-backend-1089558422014.asia-southeast1.run.app"; // 🔴 ใส่ URL Backend จริง
    const shareUrl = `${backendUrl}/share/${currentProductId}`;

    // Copy ลง Clipboard
    navigator.clipboard.writeText(shareUrl).then(() => {
        Swal.fire({
            icon: 'success',
            title: 'คัดลอกลิ้งค์แล้ว!',
            text: 'นำไปวางใน Facebook/Line ได้เลย✨',
            confirmButtonColor: '#1dd1a1'
        });
    }).catch(err => {
        // กรณี Browser ไม่รองรับการ Copy อัตโนมัติ ให้แสดง URL ให้คนกด copy เอง
        Swal.fire({
            title: 'คัดลอกลิ้งค์ด้านล่าง',
            html: `<input type="text" value="${shareUrl}" class="form-control text-center" readonly>`,
            confirmButtonColor: '#ff6b6b'
        });
    });
}

function escapeHtml(text) {
    if (!text) return "";
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}
