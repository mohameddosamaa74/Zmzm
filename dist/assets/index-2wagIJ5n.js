(function(){let e=document.createElement(`link`).relList;if(e&&e.supports&&e.supports(`modulepreload`))return;for(let e of document.querySelectorAll(`link[rel="modulepreload"]`))n(e);new MutationObserver(e=>{for(let t of e)if(t.type===`childList`)for(let e of t.addedNodes)e.tagName===`LINK`&&e.rel===`modulepreload`&&n(e)}).observe(document,{childList:!0,subtree:!0});function t(e){let t={};return e.integrity&&(t.integrity=e.integrity),e.referrerPolicy&&(t.referrerPolicy=e.referrerPolicy),t.credentials=e.crossOrigin===`use-credentials`?`include`:e.crossOrigin===`anonymous`?`omit`:`same-origin`,t}function n(e){if(e.ep)return;e.ep=!0;let n=t(e);fetch(e.href,n)}})();var e=`zmzm-cart`,t=window.ZMZAM_SUPABASE||{url:``,anonKey:``},n=!!t.url&&!!t.anonKey&&!t.url.includes(`YOUR_`)&&!t.anonKey.includes(`YOUR_`),r=null;try{n&&window.supabase?r=window.supabase.createClient(t.url,t.anonKey):console.error(`Supabase is not configured. Check VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.`)}catch(e){console.error(`Supabase client initialization failed:`,e)}function i(e){return{id:Number(e.id??0),name:e.name||``,category:e.category||`boxes`,price:Number(e.price||0),old:Number(e.old_price||e.old||0),tag:e.tag||``,meta:e.meta||``,rating:Number(e.rating||4.8),specs:e.specs||{},image:e.image||e.image_url||e.photo||``,type:e.type||(e.category===`boards`?`goldboard`:e.category===`cupcakes`?`cup`:e.category===`packaging`?`ribbon`:`box`)}}var a=[];async function o(){if(!r)return console.error(`Supabase client is not available.`),[];try{let{data:e,error:t}=await r.from(`products`).select(`*`).order(`id`,{ascending:!0});return t?(console.error(`Supabase load failed:`,t.message),[]):(console.log(`Loaded ${e?.length||0} products from Supabase.`),(e||[]).map(i))}catch(e){return console.error(`Supabase critical error:`,e),[]}}async function s(){if(a=[],!r){console.error(`Supabase is not configured. Check VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.`),g(),v();return}a=await o(),g(),v()}var c=()=>{let t=localStorage.getItem(e);if(!t)return[];try{let e=JSON.parse(t);return Array.isArray(e)?e:[]}catch{return[]}},l={cart:[],filter:`all`,search:``,sort:`popular`,visible:8},u=e=>document.querySelector(e),d=e=>`${Number(e||0).toLocaleString(`ar-EG`)} ج.م`,f={boards:`ألواح الكيك`,boxes:`علب الكيك`,cupcakes:`كب كيك`,packaging:`تغليف`},p=()=>localStorage.setItem(e,JSON.stringify(l.cart));function m(e){let t=e.image;return!t&&e.type===`box`&&(t=e.name.toLowerCase().includes(`beige`)?`/assets/cake-box-beige.png`:`/assets/cake-box-white.png`),t?`<img src="${t}" alt="${e.name}" style="width:100%;height:100%;object-fit:contain;padding:10px;border-radius:18px;display:block;background:#fff;" />`:e.type===`goldboard`||e.type===`silverboard`?`<div class="product-art ${e.type}"></div>`:e.type===`cup`?`<div class="product-art cup"><i></i><i></i><i></i></div>`:`<div class="product-art ${e.type}"></div>`}function h(){let e=a.filter(e=>{let t=l.filter===`all`||e.category===l.filter,n=l.search.toLowerCase();return t&&(!n||`${e.name} ${e.meta} ${e.id}`.toLowerCase().includes(n))});return l.sort===`low`&&e.sort((e,t)=>e.price-t.price),l.sort===`high`&&e.sort((e,t)=>t.price-e.price),l.sort===`new`&&e.sort((e,t)=>e.id-t.id),e}function g(){let e=u(`#productGrid`);if(!e)return;let t=h(),n=t.slice(0,l.visible),r=t.length===1?`منتج`:`منتجات`,i=u(`#resultsCount`);i&&(i.textContent=`عرض ${n.length} من ${t.length} ${r}`),e.innerHTML=n.length?n.map(e=>`
    <article class="product-card" data-product-id="${e.id}">
      <div class="product-image ${e.category}">
        ${e.tag?`<span class="product-badge">${e.tag}</span>`:``}
        <button class="wish" aria-label="إضافة إلى المفضلة">♡</button>
        <button class="quick-view" data-id="${e.id}">عرض سريع</button>
        ${m(e)}
      </div>

      <div class="product-info">
        <h3>${e.name}</h3>

        <div class="product-meta">
          ★ ${e.rating} &nbsp; · &nbsp; ${e.meta}
        </div>

        <div class="product-row">
          <span class="price">
            ${d(e.price)}
            ${e.old?`<del class="old-price">${d(e.old)}</del>`:``}
          </span>

          <button
            class="add-to-cart"
            data-id="${e.id}"
            aria-label="إضافة ${e.name} للسلة"
          >
            ＋
          </button>
        </div>
      </div>
    </article>`).join(``):`<div class="empty-cart" style="grid-column:1/-1">
        لم نجد منتجات مطابقة لبحثك. جرّب كلمة أخرى.
      </div>`;let a=u(`#loadMore`);a&&(a.style.display=l.visible<t.length?`block`:`none`,a.textContent=l.visible<t.length?`عرض المزيد`:`لا توجد منتجات إضافية`)}function _(e){return!!(e.image||e.type===`box`)}function v(){p();let e=l.cart.reduce((e,t)=>e+t.quantity,0),t=l.cart.reduce((e,t)=>e+t.product.price*t.quantity,0),n=t?t>=500?0:35:0,r=u(`#cartCount`);r&&(r.textContent=e);let i=u(`#drawerCount`);i&&(i.textContent=`${e} منتجات`);let a=u(`#cartItems`);a&&(a.innerHTML=l.cart.length?l.cart.map(({product:e,quantity:t})=>`
      <div class="cart-item">
        <div class="cart-thumb ${_(e)?`has-image`:``}">
          ${m(e)}
        </div>

        <div>
          <h4>${e.name}</h4>
          <small>${e.meta}</small>

          <div class="cart-controls">
            <button data-action="decrease" data-id="${e.id}">
              −
            </button>

            <span>${t}</span>

            <button data-action="increase" data-id="${e.id}">
              ＋
            </button>
          </div>
        </div>

        <div>
          <strong>${d(e.price*t)}</strong>

          <button
            class="remove-item"
            data-action="remove"
            data-id="${e.id}"
          >
            حذف
          </button>
        </div>
      </div>`).join(``):`<div class="empty-cart">
          سلتك فارغة حالياً
          <br />
          <small>أضف بعض القطع الجميلة لتبدأ.</small>
        </div>`);let o=u(`#subtotal`);o&&(o.textContent=d(t));let s=u(`#shipping`);s&&(s.textContent=n?d(n):t?`مجاني`:`—`);let c=u(`#total`);c&&(c.textContent=d(t+n))}function y(e){let t=u(`#toast`);t&&(t.textContent=e,t.classList.add(`show`),setTimeout(()=>{t.classList.remove(`show`)},2300))}function b(){u(`#cartDrawer`)?.classList.add(`open`),u(`#drawerOverlay`)?.classList.add(`visible`)}function x(){u(`#cartDrawer`)?.classList.remove(`open`),u(`#drawerOverlay`)?.classList.remove(`visible`)}function S(e){let t=a.find(t=>t.id===e);if(!t)return;let n=l.cart.find(t=>t.product.id===e);n?n.quantity+=1:l.cart.push({product:t,quantity:1}),p(),v(),y(`تمت إضافة المنتج إلى السلة`),b()}u(`#productGrid`)?.addEventListener(`click`,e=>{let t=e.target.closest(`.add-to-cart`);t&&S(Number(t.dataset.id)),e.target.closest(`.wish`)&&y(`تمت إضافة المنتج إلى المفضلة`);let n=e.target.closest(`.quick-view`);if(n){let e=a.find(e=>e.id===Number(n.dataset.id));if(!e)return;u(`#modalContent`).innerHTML=`
        <div class="modal-product">
          <div class="product-image ${e.category}">
            ${m(e)}
          </div>

          <div>
            <span class="kicker">
              ${f[e.category]||`منتج`}
            </span>

            <h2>${e.name}</h2>

            <div class="product-meta">
              ★ ${e.rating}
              &nbsp; · &nbsp;
              ${e.meta}
            </div>

            <p>
              حل أنيق وعملي يحافظ على منتجك ويمنحه مظهراً
              احترافياً من لحظة التسليم وحتى أول قضمة.
            </p>

            <div class="price">
              ${d(e.price)}
            </div>

            <button
              class="btn btn-primary wide modal-add"
              data-id="${e.id}"
            >
              أضف للسلة <span>←</span>
            </button>
          </div>
        </div>
      `,u(`#quickModal`)?.classList.add(`open`),u(`#modalBackdrop`)?.classList.add(`visible`)}}),u(`#modalContent`)?.addEventListener(`click`,e=>{let t=e.target.closest(`.modal-add`);t&&(S(Number(t.dataset.id)),u(`#quickModal`)?.classList.remove(`open`),u(`#modalBackdrop`)?.classList.remove(`visible`))});function C(){u(`#quickModal`)?.classList.remove(`open`),u(`#modalBackdrop`)?.classList.remove(`visible`)}u(`#modalClose`)?.addEventListener(`click`,C),u(`#modalBackdrop`)?.addEventListener(`click`,C),u(`#cartItems`)?.addEventListener(`click`,e=>{let t=e.target.closest(`[data-action]`);if(!t)return;let n=Number(t.dataset.id),r=l.cart.find(e=>e.product.id===n);if(r){if(t.dataset.action===`increase`)r.quantity+=1;else if(t.dataset.action===`decrease`)--r.quantity;else if(t.dataset.action===`remove`)l.cart=l.cart.filter(e=>e.product.id!==n);else return;r&&r.quantity<1&&(l.cart=l.cart.filter(e=>e.product.id!==n)),p(),v()}}),u(`#filterBar`)?.addEventListener(`click`,e=>{let t=e.target.closest(`button`);t&&(l.filter=t.dataset.filter,l.visible=8,document.querySelectorAll(`#filterBar button`).forEach(e=>e.classList.toggle(`active`,e===t)),g())}),document.querySelectorAll(`[data-filter-link]`).forEach(e=>e.addEventListener(`click`,()=>{l.filter=e.dataset.filterLink;let t=document.querySelector(`#filterBar button[data-filter="${l.filter}"]`);t&&t.click()})),u(`#sortSelect`)?.addEventListener(`change`,e=>{l.sort=e.target.value,g()}),u(`#loadMore`)?.addEventListener(`click`,()=>{l.visible+=4,g()}),u(`#cartToggle`)?.addEventListener(`click`,b),u(`#closeCart`)?.addEventListener(`click`,x),u(`#drawerOverlay`)?.addEventListener(`click`,x),u(`#checkoutBtn`)?.addEventListener(`click`,()=>{if(!l.cart.length){y(`أضف منتجاً إلى السلة أولاً`);return}p(),window.location.href=`checkout.html`}),u(`#couponBtn`)?.addEventListener(`click`,()=>u(`#couponInput`)?.value.trim()?y(`تم تطبيق كود الخصم بنجاح`):y(`اكتب كود الخصم أولاً`)),u(`#searchToggle`)?.addEventListener(`click`,()=>{u(`#searchPanel`)?.classList.toggle(`open`),u(`#searchInput`)?.focus()}),u(`#closeSearch`)?.addEventListener(`click`,()=>u(`#searchPanel`)?.classList.remove(`open`)),u(`#searchInput`)?.addEventListener(`input`,e=>{l.search=e.target.value,l.visible=8,g()}),u(`#menuToggle`)?.addEventListener(`click`,()=>u(`#mainNav`)?.classList.toggle(`open`));var w=document.querySelectorAll(`.main-nav a`);w.forEach(e=>{e.addEventListener(`click`,()=>{w.forEach(t=>t.classList.toggle(`active`,t===e))})});var T=u(`#newsletterForm`);T&&T.addEventListener(`submit`,e=>{e.preventDefault(),e.target.reset(),y(`تم اشتراكك! تحقق من بريدك للعروض القادمة.`)});var E=u(`#langToggle`);E&&E.addEventListener(`click`,()=>y(`النسخة الإنجليزية قيد الإعداد`)),document.querySelectorAll(`[data-scroll]`).forEach(e=>{e.addEventListener(`click`,()=>{let t=document.querySelector(e.dataset.scroll);t&&t.scrollIntoView()})}),document.addEventListener(`keydown`,e=>{e.key===`Escape`&&(x(),C())}),l.cart=c(),(async()=>{await s()})();