/* murasame 产品愿景原型 · 交互层
   静态原型：不读写真实数据、不调用模型、不连接主程序。
   交互只用于演示 docs/39 中 F-01 / F-02 / F-03 / F-04 的体验。 */

(function () {
  'use strict'

  var data = window.VISION_DATA
  var $ = function (selector, scope) { return (scope || document).querySelector(selector) }
  var $$ = function (selector, scope) { return Array.prototype.slice.call((scope || document).querySelectorAll(selector)) }

  var state = {
    screen: 'memory',
    filter: 'all',
    search: '',
    masked: false,
    time: 520,
    dnd: false,
    reviewVersion: 1,
    reviewDeleted: false,
    theaterPlayed: false,
    theaterLine: -1,
    theaterTimer: null,
    bubbleTimer: null,
    deleteArmed: false,
    editing: false
  }

  var screens = {
    memory: {
      title: '记忆房间',
      subtitle: '它记得的事，每一件都有来源。',
      bubble: data.petBubbles.memory
    },
    review: {
      title: '每日回顾',
      subtitle: '用真实发生的事写一页日签，不评分、不打卡。',
      bubble: data.petBubbles.review
    },
    day: {
      title: '它的一天',
      subtitle: '它有自己的时间，也有安静的边界。',
      bubble: data.scenes.morning.bubble
    }
  }

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  }

  function toast(message, tone) {
    var stack = $('#toastStack')
    var node = document.createElement('div')
    node.className = 'toast' + (tone ? ' ' + tone : '')
    node.textContent = message
    stack.appendChild(node)
    window.setTimeout(function () {
      node.style.transition = 'opacity 220ms ease, transform 220ms ease'
      node.style.opacity = '0'
      node.style.transform = 'translateY(6px)'
      window.setTimeout(function () { node.remove() }, 240)
    }, 3200)
  }

  /* ---------------- 桌宠 ---------------- */
  function speakBubble(text, options) {
    options = options || {}
    if (state.theaterTimer && !options.force) return
    var bubble = $('#petBubble')
    $('#petBubbleText').textContent = text
    bubble.hidden = false
    if (state.bubbleTimer) window.clearTimeout(state.bubbleTimer)
    if (options.autoHide !== false) {
      state.bubbleTimer = window.setTimeout(function () {
        bubble.hidden = true
      }, options.duration || 13000)
    }
  }

  function bouncePet() {
    var body = $('#petBody')
    body.classList.remove('is-bounce')
    void body.offsetWidth
    body.classList.add('is-bounce')
  }

  function defaultBubbleForScreen(key) {
    if (key === 'day') {
      var scene = currentScene()
      speakBubble(scene.bubble)
      return
    }
    speakBubble(screens[key].bubble || '')
  }

  function bindPet() {
    $('#petBody').addEventListener('click', function () {
      bouncePet()
      var lines = {
        memory: [
          '每张卡片都能点开，看看它是从哪次对话来的。',
          '你可以遮住所有内容——按 Esc 就行。',
          '被删掉的记忆，我不会再拿出来说。'
        ],
        review: [
          '回顾里没有完成率。我不想拿它给你打分。',
          '没做成的事，也在这页里。',
          '「留给明天」你可以自己改，我只负责把事实放好。'
        ],
        day: [
          '你在忙的时候，我不会为了刷存在感而说话。',
          '我的情绪会自己缓过来，不用你哄。',
          '小剧场只演真的发生过的事。'
        ]
      }
      var pool = lines[state.screen] || lines.memory
      speakBubble(pool[Math.floor(Math.random() * pool.length)])
    })
    $('#bubbleClose').addEventListener('click', function (event) {
      event.stopPropagation()
      $('#petBubble').hidden = true
      if (state.bubbleTimer) window.clearTimeout(state.bubbleTimer)
    })
  }

  /* ---------------- 导航 ---------------- */
  function showScreen(key) {
    if (!screens[key]) return
    state.screen = key
    document.body.setAttribute('data-screen', key)
    $$('.screen').forEach(function (node) { node.classList.toggle('is-active', node.id === 'screen-' + key) })
    $$('.nav-item[data-target]').forEach(function (node) { node.classList.toggle('is-active', node.dataset.target === key) })
    $('#screenTitle').textContent = screens[key].title
    $('#screenSubtitle').textContent = screens[key].subtitle
    closeSheet()
    defaultBubbleForScreen(key)
    if (key === 'review') renderReview()
    if (key === 'day') renderDay()
    if (key === 'memory') renderRoom()
    $('#content').scrollTop = 0
  }

  function bindNav() {
    $$('.nav-item[data-target]').forEach(function (node) {
      node.addEventListener('click', function () { showScreen(node.dataset.target) })
    })
  }

  /* ---------------- 记忆房间 ---------------- */
  function activeMemories() {
    return data.memories.filter(function (memory) { return memory.status === 'active' })
  }

  function categoryMeta(id) {
    return data.categories.filter(function (item) { return item.id === id })[0]
  }

  function memoryById(id) {
    return data.memories.filter(function (item) { return item.id === id })[0]
  }

  function todayLitCount() {
    return data.litEvents.filter(function (event) { return event.time.indexOf('今天') === 0 }).length
  }

  function memoryLights(memoryId) {
    return data.litEvents.filter(function (event) { return event.memoryId === memoryId })
  }

  function renderStats() {
    $('#statTotal').textContent = String(data.memories.length)
    $('#statLit').textContent = String(todayLitCount())
    $('#statRecall').textContent = '召回状态：完整'
  }

  function litEventHtml(event) {
    var memory = memoryById(event.memoryId)
    if (!memory) return ''
    var title = memory.text.length > 18 ? memory.text.slice(0, 18) + '…' : memory.text
    return '' +
      '<button class="lit-item" type="button" data-memory="' + esc(event.memoryId) + '">' +
        '<time>' + esc(event.time) + '</time>' +
        '<span class="lamp-mini"></span>' +
        '<strong>' + esc(title) + '</strong>' +
        '<p>' + esc(event.reason) + '</p>' +
      '</button>'
  }

  function renderLitTimeline() {
    $('#litTimeline').innerHTML = data.litEvents.map(litEventHtml).join('')
    $$('#litTimeline .lit-item').forEach(function (node) {
      node.addEventListener('click', function () { openDetail(node.dataset.memory) })
    })
  }

  function renderFilters() {
    var counts = {}
    data.memories.forEach(function (memory) { counts[memory.category] = (counts[memory.category] || 0) + 1 })
    var html = '<button class="chip ' + (state.filter === 'all' ? 'is-active' : '') + '" data-filter="all" type="button">全部 · ' + data.memories.length + '</button>'
    data.categories.forEach(function (category) {
      html += '<button class="chip ' + (state.filter === category.id ? 'is-active' : '') + '" data-filter="' + esc(category.id) + '" type="button">' + esc(category.title) + ' · ' + (counts[category.id] || 0) + '</button>'
    })
    $('#memoryFilters').innerHTML = html
    $$('#memoryFilters .chip').forEach(function (node) {
      node.addEventListener('click', function () {
        state.filter = node.dataset.filter
        renderFilters()
        renderRoomCards()
      })
    })
  }

  function matchFilters(memory) {
    if (state.filter !== 'all' && memory.category !== state.filter) return false
    var needle = state.search.trim().toLowerCase()
    if (!needle) return true
    return (memory.text + ' ' + memory.sourceLabel + ' ' + categoryMeta(memory.category).title).toLowerCase().indexOf(needle) >= 0
  }

  function maskedText(memory) {
    if (state.masked) return '••••••••••••••••••••'
    return memory.text
  }

  function memoryCardHtml(memory) {
    var meta = categoryMeta(memory.category)
    var lights = memory.lightCount > 0
    var lampText = lights ? '被想起 ' + memory.lightCount + ' 次' : '还没被想起'
    var invalidBadge = memory.status === 'invalid' ? '<span class="invalid-badge">已失效 · 可追溯</span>' : ''
    return '' +
      '<button class="memory-card' + (lights ? ' has-light' : '') + (memory.status === 'invalid' ? ' is-invalid' : '') + (state.masked ? ' is-masked' : '') + (matchFilters(memory) ? '' : ' is-filtered-out') + '" data-memory="' + esc(memory.id) + '" type="button">' +
        '<span class="memory-card-top">' +
          '<span class="memory-cat">' + esc(meta.title) + '</span>' +
          '<span class="memory-lamp"><i></i>' + esc(lampText) + '</span>' +
        '</span>' +
        '<span class="memory-text">' + esc(maskedText(memory)) + '</span>' +
        '<span class="memory-source">来自 <b>' + esc(memory.sourceLabel) + '</b> ' + invalidBadge + '</span>' +
      '</button>'
  }

  function renderRoomCards() {
    var html = ''
    data.categories.forEach(function (category) {
      var list = data.memories.filter(function (memory) {
        return memory.category === category.id && matchFilters(memory)
      })
      var cards = list.length
        ? list.map(memoryCardHtml).join('')
        : '<p class="footnote" style="grid-column:span 2;margin:4px 0 0">这个区域还没有记忆。它还在认识你。</p>'
      html += '' +
        '<section class="room-section" data-mark="' + esc(category.mark) + '">' +
          '<header class="room-section-head">' +
            '<div>' +
              '<div class="room-section-title"><span class="furniture">' + esc(category.furniture) + '</span><h2>' + esc(category.title) + '</h2></div>' +
              '<p>' + esc(category.desc) + '</p>' +
            '</div>' +
            '<span class="room-count">' + esc(category.en) + ' · ' + list.length + '</span>' +
          '</header>' +
          '<div class="memory-grid">' + cards + '</div>' +
        '</section>'
    })
    $('#roomSections').innerHTML = html
    $$('#roomSections .memory-card').forEach(function (node) {
      node.addEventListener('click', function () {
        if (state.masked) {
          toast('当前处于隐私遮罩状态。先按 Esc 或点「隐私遮罩」恢复。', 'warn')
          return
        }
        openDetail(node.dataset.memory)
      })
    })
  }

  function renderRoom() {
    renderStats()
    renderLitTimeline()
    renderFilters()
    renderRoomCards()
    $('#privacyButton').innerHTML = state.masked
      ? '恢复显示 <kbd>Esc</kbd>'
      : '隐私遮罩 <kbd>Esc</kbd>'
    $('#privacyButton').classList.toggle('btn-primary', state.masked)
  }

  function simulateRecall() {
    var litIds = data.litEvents.map(function (event) { return event.memoryId })
    var candidates = activeMemories().filter(function (memory) { return litIds.indexOf(memory.id) < 0 })
    if (!candidates.length) {
      toast('没有可用于演示的未点亮记忆。刷新页面可恢复演示数据。', 'warn')
      return
    }
    var picks = candidates.slice(0, 2)
    var reasons = [
      '你这句话和它的内容语义相近，它被注入本轮上下文',
      '本轮对话需要这条背景，它被召回并实际使用'
    ]
    picks.forEach(function (memory, index) {
      data.litEvents.unshift({
        id: 'light-sim-' + Date.now() + '-' + index,
        memoryId: memory.id,
        time: '刚刚',
        title: memory.text.slice(0, 18),
        reason: reasons[index % reasons.length],
        level: 'glow'
      })
      memory.lightCount += 1
      memory.updated = '2026-11-13'
    })
    renderRoom()
    picks.forEach(function (memory) {
      var card = $('#roomSections .memory-card[data-memory="' + memory.id + '"]')
      if (card) {
        card.classList.add('is-lit')
        window.setTimeout(function () { card.classList.remove('is-lit') }, 1700)
      }
    })
    toast('模拟召回：' + picks.length + ' 条记忆真实进入本轮上下文，所以被点亮。没有召回的不会被补点。', 'coral')
    speakBubble('刚才想到你提过的事。要不要看看它是怎么被想起来的？', { force: true })
  }

  function bindMemoryRoom() {
    $('#memorySearch').addEventListener('input', function (event) {
      state.search = event.target.value
      renderRoomCards()
    })
    $('#simulateRecallButton').addEventListener('click', simulateRecall)
    $('#privacyButton').addEventListener('click', function () {
      state.masked = !state.masked
      renderRoom()
      toast(state.masked ? '隐私遮罩已开启：正文被替换，仅保留分类与数量。' : '已恢复显示。', state.masked ? 'warn' : '')
    })
  }

  /* ---------------- 记忆详情 ---------------- */
  function closeSheet() {
    $('#detailSheet').hidden = true
    $('#sheetOverlay').hidden = true
    state.editing = false
    state.deleteArmed = false
  }

  function openDetail(memoryId) {
    var memory = memoryById(memoryId)
    if (!memory) return
    state.editing = false
    state.deleteArmed = false
    var meta = categoryMeta(memory.category)
    $('#sheetTitle').textContent = memory.text.length > 24 ? memory.text.slice(0, 24) + '…' : memory.text
    renderSheetBody(memory, meta)
    $('#detailSheet').hidden = false
    $('#sheetOverlay').hidden = false
  }

  function sourceKindLabel(kind) {
    return { conversation: '来自对话', task: '来自任务', manual: '手动添加', autonomy: '来自自主活动' }[kind] || '来源未知'
  }

  function renderSheetBody(memory, meta) {
    var lights = memoryLights(memory.id)
    var lightRows = lights.length
      ? lights.map(function (event) {
          return '<div class="light-history-row"><time>' + esc(event.time) + '</time><span>' + esc(event.reason) + '</span></div>'
        }).join('')
      : '<div class="light-history-row"><time>—</time><span>还没有被真实召回。它可能只是安静地待在这里。</span></div>'
    var invalidNote = memory.status === 'invalid'
      ? '<p class="sheet-hint">这条记忆已失效：' + (memory.validUntil ? '失效于 ' + esc(memory.validUntil) + '。' : '') + '它仍可追溯，但不会进入后续对话。<br>被新事实取代属于正常更新，不是删除。</p>'
      : ''
    var body = '' +
      '<div class="detail-meta">' +
        '<span class="pill pill-violet">' + esc(meta.title) + '</span>' +
        '<span class="pill ' + (memory.status === 'invalid' ? 'pill-amber' : 'pill-green') + '">' + (memory.status === 'invalid' ? '已失效' : '有效') + '</span>' +
        '<span class="pill pill-gray">被想起 ' + memory.lightCount + ' 次</span>' +
      '</div>' +
      '<div class="detail-block">' +
        '<span class="detail-label">正文</span>' +
        '<p class="detail-text" id="detailText">' + esc(memory.text) + '</p>' +
        '<div class="sheet-editor" id="detailEditor" hidden>' +
          '<textarea id="detailTextarea" aria-label="更正记忆正文">' + esc(memory.text) + '</textarea>' +
          '<div class="editor-row"><button class="btn btn-sm" data-action="cancel-edit" type="button">取消</button><button class="btn btn-sm btn-primary" data-action="save-edit" type="button">保存更正</button></div>' +
        '</div>' +
      '</div>' +
      '<div class="detail-block">' +
        '<span class="detail-label">来源</span>' +
        '<div class="source-box">' +
          '<p>' + esc(memory.sourceLabel) + '</p>' +
          '<small>' + esc(memory.sourceDetail) + '</small>' +
          '<small>' + esc(sourceKindLabel(memory.sourceKind)) + ' · 首次记录 ' + esc(memory.created) + ' · 最近更新 ' + esc(memory.updated) + '</small>' +
        '</div>' +
      '</div>' +
      '<div class="detail-block">' +
        '<span class="detail-label">被点亮记录</span>' +
        '<div class="light-history">' + lightRows + '</div>' +
      '</div>' +
      '<div class="detail-block">' +
        '<span class="detail-label">这份记忆的边界</span>' +
        '<div class="source-box"><p>只在本机保存。删除后不会再进入后续对话、主动互动与每日回顾；历史对话本身不受影响。</p></div>' +
      '</div>' +
      invalidNote +
      '<div class="sheet-actions">' +
        '<button class="btn btn-sm" data-action="edit" type="button">更正</button>' +
        '<button class="btn btn-sm btn-danger" data-action="delete" type="button">' + (state.deleteArmed ? '确认删除？' : '删除') + '</button>' +
        '<button class="btn btn-sm btn-ghost" data-action="mute" type="button">别主动提这条</button>' +
      '</div>' +
      '<p class="sheet-hint">设计说明：点亮只由主进程在「真实召回并注入上下文」时写入；删除会让房间、回顾与后续召回同时消失（docs/39 F-01 · NFR-S02）。</p>'
    var bodyNode = $('#sheetBody')
    bodyNode.innerHTML = body
    $$('[data-action]', bodyNode).forEach(function (node) {
      node.addEventListener('click', function () { handleSheetAction(node.dataset.action, memory) })
    })
  }

  function handleSheetAction(action, memory) {
    if (action === 'edit') {
      state.editing = true
      state.deleteArmed = false
      $('#detailText').hidden = true
      $('#detailEditor').hidden = false
      $('#detailTextarea').focus()
      return
    }
    if (action === 'cancel-edit') {
      renderSheetBody(memory, categoryMeta(memory.category))
      return
    }
    if (action === 'save-edit') {
      var value = $('#detailTextarea').value.trim()
      if (!value) {
        toast('记忆正文不能为空。', 'warn')
        return
      }
      memory.text = value
      memory.updated = '2026-11-13'
      data.litEvents.unshift({
        id: 'light-correction-' + Date.now(),
        memoryId: memory.id,
        time: '刚刚',
        title: value.slice(0, 18),
        reason: '你更正了这条记忆；后续对话会使用新值',
        level: 'glow'
      })
      renderRoom()
      openDetail(memory.id)
      toast('已更正。后续对话会使用新值；旧值作为失效记录保留，可追溯。')
      return
    }
    if (action === 'delete') {
      if (!state.deleteArmed) {
        state.deleteArmed = true
        renderSheetBody(memory, categoryMeta(memory.category))
        return
      }
      data.memories = data.memories.filter(function (item) { return item.id !== memory.id })
      data.litEvents = data.litEvents.filter(function (event) { return event.memoryId !== memory.id })
      closeSheet()
      renderRoom()
      toast('已删除。这条不会再进入对话、主动互动或回顾；历史对话本身不变。', 'danger')
      return
    }
    if (action === 'mute') {
      toast('已记录：它不会再主动提这一条。对话里你问到时仍可回答。')
    }
  }

  function bindSheet() {
    $('#sheetClose').addEventListener('click', closeSheet)
    $('#sheetOverlay').addEventListener('click', closeSheet)
  }

  /* ---------------- 每日回顾 ---------------- */
  function reviewSectionHtml(index, title, subtitle, body, wide) {
    return '' +
      '<section class="review-section' + (wide ? ' wide' : '') + '">' +
        '<header class="review-section-head">' +
          '<div class="review-section-title">' +
            '<span class="review-index">' + esc(index) + '</span>' +
            '<div><h2>' + esc(title) + '</h2><p>' + esc(subtitle) + '</p></div>' +
          '</div>' +
        '</header>' +
        body +
      '</section>'
  }

  function renderReview() {
    var review = data.review
    var sections = $('#reviewSections')
    var empty = $('#reviewEmpty')
    if (state.reviewDeleted) {
      sections.innerHTML = ''
      $('#reviewSources').hidden = true
      empty.hidden = false
      $('#reviewStatusPill').textContent = '已删除'
      $('#reviewStatusPill').className = 'pill pill-gray'
      return
    }
    empty.hidden = true
    $('#reviewSources').hidden = false
    $('#reviewMeta').textContent = review.meta.replace('依据 14 条来源', '依据 ' + review.sources.length + ' 条来源')
    $('#reviewStatusPill').textContent = '已生成 · 本地 v' + state.reviewVersion
    $('#reviewStatusPill').className = 'pill pill-green'

    var conversations = review.conversations.map(function (item) {
      return '' +
        '<div class="review-item">' +
          '<span class="bullet"></span>' +
          '<div class="item-body"><p class="item-text">' + esc(item.text) + '</p>' +
            '<p><a class="review-link" href="#" data-noop="conversation">' + esc(item.source) + '</a> · ' + esc(item.time) + '</p>' +
          '</div>' +
        '</div>'
    }).join('')

    var outcomes = review.outcomes.map(function (item) {
      return '' +
        '<div class="review-item">' +
          '<span class="outcome-status ' + esc(item.tone) + '">' + esc(item.status) + '</span>' +
          '<div class="item-body"><strong>' + esc(item.title) + '</strong>' +
            '<p>' + esc(item.summary) + '</p>' +
            '<p class="verify-note">' + esc(item.verdict) + ' · ' + esc(item.time) + '</p>' +
          '</div>' +
        '</div>'
    }).join('')

    var memoryChanges = review.memories.map(function (item) {
      return '' +
        '<div class="memory-change">' +
          '<span class="change-kind">' + esc(item.kind) + '</span>' +
          '<span>' + esc(item.text) + '<small>' + esc(item.note) + '</small></span>' +
        '</div>'
    }).join('')

    var observation = review.observations.map(function (item) {
      return '' +
        '<div class="observation-card">' +
          '<div class="obs-head"><strong>' + esc(item.title) + '</strong><span class="pill pill-blue">隔离环境</span></div>' +
          '<p>' + esc(item.text) + '</p>' +
          '<span class="limitation">' + esc(item.limitation) + '</span>' +
        '</div>'
    }).join('')

    var tomorrow = review.tomorrow.map(function (item, index) {
      return '' +
        '<div class="tomorrow-row">' +
          '<span class="num">0' + (index + 1) + '</span>' +
          '<input class="tomorrow-input" data-tomorrow="' + index + '" value="' + esc(item.text) + '" placeholder="留给你自己写…">' +
          '<span class="tomorrow-source">' + esc(item.source) + '</span>' +
        '</div>'
    }).join('') +
      '<div class="tomorrow-foot"><span>只保存在本机；保存不会外发。</span><button class="btn btn-sm btn-primary" id="saveTomorrowButton" type="button">保存留给明天</button></div>'

    sections.innerHTML =
      reviewSectionHtml('01', '今天聊了什么', '只摘真实发生的对话，敏感内容打码', '<div class="review-list">' + conversations + '</div>', true) +
      reviewSectionHtml('02', '做成 / 没做成', '失败必须出现，核验结论照实写', '<div class="review-list">' + outcomes + '</div>', true) +
      reviewSectionHtml('03', '它记住的', '新增、更正、失效都可见来源', '<div class="memory-change-list">' + memoryChanges + '</div>', false) +
      reviewSectionHtml('04', '它看到的', '自主活动只在隔离环境；外部内容只转述', observation, false) +
      reviewSectionHtml('05', '留给明天', '最多三件；你可以改，也可以空着', '<div class="tomorrow-list">' + tomorrow + '</div>', true)

    $$('a[data-noop]').forEach(function (link) {
      link.addEventListener('click', function (event) {
        event.preventDefault()
        toast('原型未实现跳转；正式版会打开对应会话并高亮来源消息。')
      })
    })
    var saveButton = $('#saveTomorrowButton')
    if (saveButton) {
      saveButton.addEventListener('click', function () {
        $$('.tomorrow-input').forEach(function (input) {
          review.tomorrow[Number(input.dataset.tomorrow)].text = input.value
        })
        toast('「留给明天」已保存到本机。它不会因此催你。')
      })
    }

    var sourceRows = review.sources.map(function (source) { return '<code>' + esc(source) + '</code>' }).join('')
    $('#sourcesBody').innerHTML = '' +
      '<div class="sources-row">生成方式：<strong>本地模板</strong>（没有调用模型，也没有把内容外发）</div>' +
      '<div class="sources-row">无来源被丢弃：<strong>' + review.droppedFacts + '</strong> 条 · 缺失数据源：<strong>' + (review.missingSources.length ? esc(review.missingSources.join('、')) : '无') + '</strong></div>' +
      '<div class="sources-row">来源（' + review.sources.length + '）：</div>' +
      '<div class="sources-row">' + sourceRows + '</div>'
  }

  function bindReview() {
    $('#regenButton').addEventListener('click', function () {
      var button = $('#regenButton')
      button.disabled = true
      button.textContent = '正在生成…'
      window.setTimeout(function () {
        state.reviewVersion += 1
        button.disabled = false
        button.textContent = '重新生成'
        state.reviewDeleted = false
        renderReview()
        toast('已重新生成 v' + state.reviewVersion + '。只重新组织真实事实，不会编新内容。', 'coral')
      }, 900)
    })
    $('#deleteReviewButton').addEventListener('click', function () {
      state.reviewDeleted = true
      renderReview()
      toast('回顾已删除。对话与任务记录不受影响；它不会追问，也不会因此不高兴。', 'danger')
    })
    $('#undoDeleteReview').addEventListener('click', function () {
      state.reviewDeleted = false
      renderReview()
      toast('演示数据已恢复。')
    })
  }

  /* ---------------- 它的一天 ---------------- */
  function currentScene() {
    var slot = data.timeSlots.filter(function (item) { return state.time >= item.from && state.time < item.to })[0]
    return data.scenes[(slot || data.timeSlots[0]).key]
  }

  function formatTime(minutes) {
    var h = Math.floor(minutes / 60)
    var m = minutes % 60
    return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m
  }

  function weatherSvg(kind) {
    if (kind === '晴') {
      return '<svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="13" fill="#f0b95c"/><g stroke="#e5a83f" stroke-width="3.4" stroke-linecap="round"><path d="M32 8v7M32 49v7M8 32h7M49 32h7M15 15l5 5M44 44l5 5M49 15l-5 5M20 44l-5 5"/></g></svg>'
    }
    if (kind === '小雨') {
      return '<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M18 39c-5 0-8-3.6-8-8 0-4.8 3.8-8.4 8.6-8.4 1-5.4 5.7-9.2 11.4-9.2 6.3 0 11.3 4.6 11.9 10.6 4.8.2 8.1 3.5 8.1 7.8 0 4.4-3.4 7.2-7.9 7.2H18Z" fill="#b9c4cd"/><g stroke="#7d9ab5" stroke-width="2.6" stroke-linecap="round"><path d="M22 48l-2 5M32 48l-2 5M42 48l-2 5"/></g></svg>'
    }
    if (kind === '阴') {
      return '<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M18 40c-5 0-8-3.6-8-8 0-4.8 3.8-8.4 8.6-8.4 1-5.4 5.7-9.2 11.4-9.2 6.3 0 11.3 4.6 11.9 10.6 4.8.2 8.1 3.5 8.1 7.8 0 4.4-3.4 7.2-7.9 7.2H18Z" fill="#aab4bd"/><path d="M28 46c-3.5 0-5.6-2.5-5.6-5.6 0-3.4 2.7-5.9 6-5.9.7-3.8 4-6.4 8-6.4 4.4 0 7.9 3.2 8.3 7.4 3.4.1 5.7 2.4 5.7 5.4 0 3.1-2.4 5.1-5.5 5.1H28Z" fill="#c6cfd6"/></svg>'
    }
    return '<svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="40" cy="25" r="10" fill="#f0c46d"/><path d="M17 42c-5 0-8-3.6-8-8 0-4.8 3.8-8.4 8.6-8.4 1-5.4 5.7-9.2 11.4-9.2 6.3 0 11.3 4.6 11.9 10.6 4.8.2 8.1 3.5 8.1 7.8 0 4.4-3.4 7.2-7.9 7.2H17Z" fill="#c9d3da"/></svg>'
  }

  function renderWeather() {
    var weather = data.weather
    $('#weatherIcon').innerHTML = weatherSvg(weather.mood)
    $('#weatherLabel').textContent = weather.mood + ' · ' + weather.motion
    $('#weatherSummary').textContent = weather.summary
    $('#weatherUpdated').textContent = weather.updated
    $('#weatherCauses').innerHTML = weather.causes.map(function (cause) {
      return '<li><span>' + esc(cause.text) + '</span><time>' + esc(cause.at) + '</time></li>'
    }).join('')
    $('#petWeatherBadge').textContent = '☁ ' + weather.mood
  }

  function renderRelationship() {
    var rel = data.relationship
    $('#relationshipStrip').innerHTML = rel.stages.map(function (stage) {
      var index = rel.stages.indexOf(stage)
      var currentIndex = rel.stages.indexOf(rel.stage)
      var cls = index === currentIndex ? 'is-current' : index < currentIndex ? 'is-done' : ''
      return '<div class="rel-node ' + cls + '">' + esc(stage) + '</div>'
    }).join('')
    $('#relationHistory').innerHTML = rel.history.map(function (item) {
      return '<div class="relation-row"><time>' + esc(item.date) + '</time><strong>' + esc(item.stage) + '</strong><span>' + esc(item.note) + '</span></div>'
    }).join('')
  }

  function sceneVisualSvg(sceneKey) {
    var sun = '<circle cx="32" cy="30" r="11" fill="#f2c46a"/><g stroke="#e9b453" stroke-width="2.6" stroke-linecap="round"><path d="M32 8v6M32 46v6M10 30h6M48 30h6M16 14l4 4M44 42l4 4M48 14l-4 4M20 42l-4 4"/></g><path d="M6 50c7-10 20-13 31-9 8 3 15 8 21 16H6Z" fill="rgba(255,255,255,0.08)"/>'
    var work = '<rect x="10" y="12" width="44" height="34" rx="4" fill="rgba(255,255,255,0.06)" stroke="rgba(255,255,255,0.2)" stroke-width="1.6"/><path d="M18 22h20M18 29h28M18 36h14" stroke="rgba(255,255,255,0.34)" stroke-width="2.4" stroke-linecap="round"/><circle cx="46" cy="44" r="8" fill="#7f92ab"/>'
    var noon = '<circle cx="40" cy="22" r="9" fill="#f2c46a"/><path d="M14 44c-5 0-8-3.4-8-7.6 0-4.5 3.6-7.9 8-7.9 1-5 5.4-8.6 10.7-8.6 5.9 0 10.6 4.3 11.2 9.9 4.5.2 7.6 3.2 7.6 7.3 0 4.1-3.2 6.9-7.4 6.9H14Z" fill="rgba(255,255,255,0.22)"/>'
    var evening = '<path d="M8 48h48" stroke="rgba(255,255,255,0.22)" stroke-width="2"/><path d="M14 48a18 18 0 0 1 36 0" fill="#e08a67"/><g stroke="#f0b98d" stroke-width="2.2" stroke-linecap="round"><path d="M32 6v6M12 16l4 4M52 16l-4 4M6 34h6M52 34h6"/></g>'
    var night = '<path d="M40 12a18 18 0 1 0 12 24 20 20 0 0 1-12-24Z" fill="#d8d2ea"/><g fill="#f2c46a"><circle cx="18" cy="14" r="1.8"/><circle cx="50" cy="16" r="1.4"/><circle cx="14" cy="34" r="1.2"/><circle cx="53" cy="42" r="1.8"/><circle cx="24" cy="50" r="1.2"/></g>'
    var art = { morning: sun, work: work, noon: noon, afternoon: sun, evening: evening, night: night }[sceneKey] || sun
    var label = { morning: 'MORNING', work: 'FOCUS', noon: 'NOON', afternoon: 'AFTERNOON', evening: 'EVENING', night: 'NIGHT' }[sceneKey] || ''
    return '<svg viewBox="0 0 64 64" role="img" aria-label="' + esc(label) + '">' + art + '</svg><span>' + esc(label) + '</span>'
  }

  function renderScene() {
    var scene = currentScene()
    var hero = $('#sceneHero')
    hero.className = 'scene-hero ' + scene.theme
    $('#sceneVisual').innerHTML = sceneVisualSvg(scene.key)
    $('#timeReadout').textContent = formatTime(state.time)
    $('#sceneTimeLabel').textContent = scene.label + ' ' + formatTime(state.time)
    $('#sceneTitle').textContent = scene.title
    $('#sceneText').textContent = scene.text
    $('#sceneBubbleText').textContent = scene.bubble
    $('#sceneBubbleWho').textContent = '小满'
    $('#sceneAside').innerHTML = scene.tags.map(function (tag) {
      return '<span class="scene-tag ' + (tag.kind || '') + '">' + esc(tag.text) + '</span>'
    }).join('')

    var presenceLabel = state.dnd ? '勿扰' : scene.presenceLabel
    $('#presencePill').textContent = presenceLabel
    $$('.presence-mode').forEach(function (node) {
      node.classList.toggle('is-current', node.dataset.mode === scene.presence && !state.dnd)
    })

    var judgment = scene.judgment
    var speak = state.dnd ? false : judgment.speak
    var title = state.dnd ? '勿扰中：不开口' : judgment.title
    var detail = state.dnd ? '勿扰模式会拦下所有主动互动；用户主动找它不受影响。' : judgment.detail
    $('#judgment').innerHTML = '' +
      '<div class="judgment-verdict ' + (speak ? 'speak' : 'quiet') + '">' + (speak ? '说' : '静') + '</div>' +
      '<div class="judgment-copy"><strong>' + esc(title) + '</strong><p>' + esc(detail) + '</p></div>'
    var checks = scene.checks.map(function (check) {
      return '<span class="check-chip ' + check.state + '">' + esc(check.label) + '</span>'
    })
    if (state.dnd) checks.push('<span class="check-chip block">勿扰已开启</span>')
    $('#judgmentChecks').innerHTML = checks.join('')
    speakBubble(scene.bubble, { force: true })
  }

  function renderTheater() {
    var scene = data.theater
    $('#theaterScene').innerHTML = '' +
      '<div class="theater-source">' + esc(scene.source) + ' · ' + esc(scene.time) + ' · 有真实来源</div>' +
      '<ol class="theater-lines">' + scene.lines.map(function (line, index) {
        return '<li data-line="' + index + '"><span class="line-num">0' + (index + 1) + '</span><span class="line-text">' + esc(line) + '</span></li>'
      }).join('') + '</ol>'
    var playing = state.theaterLine >= 0
    $('#theaterStatus').textContent = playing
      ? '演出中 · ' + (state.theaterLine + 1) + '/' + scene.lines.length
      : state.theaterPlayed ? '已演 · 不重播' : '待播 · 1 幕'
    $('#theaterStatus').className = playing ? 'pill pill-blue' : state.theaterPlayed ? 'pill pill-gray' : 'pill pill-amber'
    $('#playTheaterButton').disabled = state.theaterPlayed
    $('#playTheaterButton').textContent = playing ? '演出中…' : state.theaterPlayed ? '已演过' : '演一幕'
  }

  function stopTheater(showToast) {
    if (state.theaterTimer) {
      window.clearTimeout(state.theaterTimer)
      state.theaterTimer = null
    }
    state.theaterLine = -1
    $('.theater-card').classList.remove('is-playing')
    $$('#theaterScene .theater-lines li').forEach(function (node) { node.classList.remove('is-current') })
    if (showToast) toast('已跳过。同一事件不会重播；脚边状态仍会保留这件事。')
  }

  function playTheater() {
    if (state.theaterPlayed) return
    state.theaterPlayed = true
    state.theaterLine = 0
    $('.theater-card').classList.add('is-playing')
    renderTheater()
    $('#playTheaterButton').disabled = true
    speakBubble(data.theater.lines[0], { autoHide: false, force: true })
    $$('#theaterScene .theater-lines li').forEach(function (node, index) {
      node.classList.toggle('is-current', index === 0)
    })
    var index = 0
    var step = function () {
      index += 1
      if (index >= data.theater.lines.length) {
        state.theaterTimer = window.setTimeout(function () {
          stopTheater()
          state.theaterPlayed = true
          renderTheater()
          speakBubble('演完了。同一件事今天不会再演一遍。', { force: true })
          toast('这一幕已演过；同一事件不会重复播放。', 'coral')
        }, 1800)
        return
      }
      state.theaterLine = index
      speakBubble(data.theater.lines[index], { autoHide: false, force: true })
      $('#theaterStatus').textContent = '演出中 · ' + (index + 1) + '/' + data.theater.lines.length
      $$('#theaterScene .theater-lines li').forEach(function (node, lineIndex) {
        node.classList.toggle('is-current', lineIndex === index)
      })
      state.theaterTimer = window.setTimeout(step, 2100)
    }
    state.theaterTimer = window.setTimeout(step, 2100)
  }

  function renderDay() {
    renderScene()
    renderWeather()
    renderRelationship()
    renderTheater()
    $('#timeSlider').value = String(state.time)
    if (state.dnd) speakBubble('勿扰已开启。我在，但不会主动开口。')
  }

  function bindDay() {
    $('#timeSlider').addEventListener('input', function (event) {
      state.time = Number(event.target.value)
      renderScene()
    })
    $('#dndToggle').addEventListener('change', function (event) {
      state.dnd = event.target.checked
      renderScene()
      toast(state.dnd ? '勿扰已开启：它不会主动开口；你找它时仍会回应。' : '勿扰已关闭：它会在有真实理由且不打扰时开口。', state.dnd ? 'warn' : '')
    })
    $('#playTheaterButton').addEventListener('click', playTheater)
    $('#skipTheaterButton').addEventListener('click', function () {
      stopTheater(false)
      state.theaterPlayed = true
      renderTheater()
      $('#petBubble').hidden = true
      toast('已跳过。同一事件不会重播；脚边状态仍会保留这件事。')
    })
    $('#openTheaterDetail').addEventListener('click', function () {
      toast('正式版会打开对应任务详情并展示核验证据；原型不接主程序。')
    })
  }

  /* ---------------- 设计说明 ---------------- */
  function openNotes() {
    $('#notesModal').hidden = false
    $('#notesOverlay').hidden = false
  }
  function closeNotes() {
    $('#notesModal').hidden = true
    $('#notesOverlay').hidden = true
  }

  /* ---------------- 键盘与时钟 ---------------- */
  function bindKeys() {
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') {
        if (!$('#notesModal').hidden) { closeNotes(); return }
        if (!$('#detailSheet').hidden) { closeSheet(); return }
        if (state.masked) {
          state.masked = false
          renderRoom()
          toast('已恢复显示。')
          return
        }
        return
      }
      if (event.target && /INPUT|TEXTAREA/.test(event.target.tagName)) return
      if (event.key === '1') showScreen('memory')
      if (event.key === '2') showScreen('review')
      if (event.key === '3') showScreen('day')
    })
  }

  function bindClock() {
    var update = function () {
      var now = new Date()
      var h = now.getHours()
      var m = now.getMinutes()
      $('#clock').textContent = (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m
    }
    update()
    window.setInterval(update, 20000)
  }

  function bindChrome() {
    $('#notesButton').addEventListener('click', openNotes)
    $('#notesClose').addEventListener('click', closeNotes)
    $('#notesDismiss').addEventListener('click', closeNotes)
    $('#notesOverlay').addEventListener('click', closeNotes)
  }

  function init() {
    bindNav()
    bindMemoryRoom()
    bindSheet()
    bindReview()
    bindDay()
    bindPet()
    bindKeys()
    bindClock()
    bindChrome()
    renderRoom()
    renderReview()
    renderDay()
    showScreen('memory')
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init)
  } else {
    init()
  }
})()
