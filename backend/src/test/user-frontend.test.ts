import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("user frontend shell", () => {
  const html = readFileSync(join(process.cwd(), "..", "index.html"), "utf8");

  it("does not expose removed user-side queue and recent-generation affordances", () => {
    expect(html).not.toContain('data-action="queue"');
    expect(html).not.toContain("<h2>最近生成</h2>");
    expect(html).not.toContain("后续后台可配置套餐名称、价格、积分数量、有效期、是否启用和排序");
  });

  it("keeps admin entry behind a role-aware frontend gate", () => {
    expect(html).toContain('data-admin-only');
    expect(html).toContain("roleVerified");
    expect(html).toContain("/api/me");
  });

  it("shows an empty queue state when the user has no active generation jobs", () => {
    expect(html).toContain("暂无视频队列");
  });

  it("does not auto-trigger provider status sync from frontend polling", () => {
    expect(html).not.toContain("syncProviderJobs");
    expect(html).not.toContain("Promise.allSettled");
    expect(html).not.toContain("void refreshVideoJobs({");
    expect(html).not.toContain("const followUp = createdJob.providerTaskId");
    expect(html).toContain('data-action="sync-job"');
  });

  it("does not show the user's email on the redemption page by default", () => {
    const redeemSection = html.match(/<section class="view" id="view-redeem">[\s\S]*?<\/section>\s*<\/section>/)?.[0] ?? "";
    expect(redeemSection).toContain("data-redemption-account-state");
    expect(redeemSection).not.toContain("data-user-email");
    expect(redeemSection).toContain('name="redemptionCode"');
    expect(redeemSection).toContain('autocomplete="one-time-code"');
  });

  it("loads and renders masked user redemption records", () => {
    expect(html).toContain("/api/credits/redemptions");
    expect(html).toContain("renderRedemptionRecords");
    expect(html).toContain("refreshRedemptionRecords");
    expect(html).toContain("data-redemption-record-rows");
    expect(html).toContain("validityDays");
    expect(html).toContain("有效期");
    expect(html).toContain("暂无兑换记录");
  });

  it("uses unified localized API error messages for common user failures", () => {
    expect(html).toContain("function apiErrorMessage");
    expect(html).toContain("AUTH_REQUIRED");
    expect(html).toContain("USER_BANNED");
    expect(html).toContain("INSUFFICIENT_CREDITS");
    expect(html).toContain("REDEMPTION_CODE_NOT_FOUND");
    expect(html).toContain("VIDEO_JOB_DELETE_NOT_ALLOWED");
    expect(html).toContain("error.code = data?.code");
  });

  it("keeps account management on the white page surface with aligned password fields", () => {
    expect(html).toContain("#view-account > .panel");
    expect(html).not.toContain("background: #11110f");
    expect(html).toContain("password-help-row");
  });

  it("labels sidebar credits as available credits and syncs the meter from the balance", () => {
    expect(html).toContain("可用积分");
    expect(html).toContain("data-credit-validity");
    expect(html).toContain("updateCreditValidity");
    expect(html).not.toContain("本月积分");
    expect(html).not.toContain('<div class="nav-label">系统</div>');
    expect(html).toContain("data-credit-meter");
    expect(html).not.toContain("width: 68%");
    expect(html).toContain("updateCreditMeter");
    expect(html).toContain("style.width");
  });

  it("initializes redemption state before hydrating sidebar credit validity", () => {
    const stateIndex = html.indexOf("let redemptionRecords = [];");
    const initialHydrationIndex = html.indexOf("updateUserUI(readStoredUser());");
    expect(stateIndex).toBeGreaterThan(-1);
    expect(initialHydrationIndex).toBeGreaterThan(-1);
    expect(stateIndex).toBeLessThan(initialHydrationIndex);
    expect(html).not.toContain("function updateCreditValidity(records = redemptionRecords)");
  });

  it("loads public models, credit packages, and video jobs from backend APIs", () => {
    expect(html).toContain("/api/models");
    expect(html).toContain("/api/credit-packages");
    expect(html).toContain("/api/video/jobs");
    expect(html).toContain("/api/video/assets");
    expect(html).toContain("renderModels");
    expect(html).toContain("renderCreditPackages");
    expect(html).toContain("renderVideoJobs");
    expect(html).toContain("renderProjectVideos");
    expect(html).toContain("refreshVideoJobs");
    expect(html).toContain("refreshProjectVideos");
    expect(html).toContain("/sync");
    expect(html).toContain("syncVideoJob");
    expect(html).toContain("/download-url");
    expect(html).toContain("downloadVideoJob");
    expect(html).toContain("/process");
    expect(html).toContain("processMockVideoJob");
    expect(html).toContain("createdJob.providerTaskId");
    expect(html).toContain("startVideoJobPolling");
  });

  it("opens configured package purchase URLs from buy buttons", () => {
    expect(html).toContain('data-purchase-url="${escapeHtml(pkg.purchaseUrl || "")}"');
    expect(html).toContain("function buyCreditPackage(button)");
    expect(html).toContain("window.location.href = purchaseUrl");
    expect(html).toContain("buyCreditPackage(target)");
  });

  it("keeps generation tasks separate from deletable project videos", () => {
    expect(html).toContain("/api/video/assets");
    expect(html).toContain("refreshProjectVideos");
    expect(html).toContain("deleteProjectVideo");
    expect(html).not.toContain('data-action="delete-preview"');
    expect(html).not.toContain('data-action="delete-card" data-job-id');
    expect(html).not.toContain("/api/video/jobs/${jobId}`, { method: \"DELETE\" }");
  });

  it("plays project videos inline on their project cards", () => {
    expect(html).toContain("async function playProjectVideo(assetId)");
    expect(html).toContain("`/api/video/assets/${assetId}/download-url`");
    expect(html).toContain('data-project-player="${escapeHtml(asset.id)}"');
    expect(html).toContain("player.src = await getVideoObjectUrl(asset)");
    expect(html).toContain("hydrateProjectVideoCovers(projectVideos)");
    expect(html).toContain("async function loadProjectVideoCover(asset)");
    expect(html).toContain("player.currentTime = Math.min(0.1");
    expect(html).toContain("await playProjectVideo(assetId)");
    expect(html).not.toContain('showToast("已加载项目视频")');
    expect(html).not.toContain('class="thumb ${["one", "two", "three"][index % 3]}"');
    expect(html).not.toContain("接入视频地址后可直接播放");
  });

  it("keeps the create-page video stage empty until jobs run or complete", () => {
    expect(html).toContain('data-preview-state');
    expect(html).toContain('data-preview-empty');
    expect(html).toContain('data-preview-loading');
    expect(html).toContain('data-preview-player');
    expect(html).toContain("暂无正在生成的视频");
    expect(html).toContain("视频生成中...");
    expect(html).not.toContain("最新已下载视频");
    expect(html).not.toContain("播放、暂停、进度拖动和全屏使用浏览器原生控件");
    expect(html).not.toContain("清晨城市天台 - 最新完成");
    expect(html).not.toContain("服务器仅保存 3 天，过期后视频文件和生成记录自动删除。");
    expect(html).not.toContain('data-action="refresh"');
    expect(html).not.toContain('class="toolbar-actions"');
  });

  it("polls only while video jobs are active and stops after completion", () => {
    expect(html).toContain("const VIDEO_POLLING_INTERVAL_MS = 1500");
    expect(html).toContain("function reconcileVideoJobPolling()");
    expect(html).toContain("function stopVideoJobPolling()");
    expect(html).toContain("if (activeVideoJobs().length)");
    expect(html).toContain("startVideoJobPolling();");
    expect(html).toContain("stopVideoJobPolling();");
    expect(html).toContain("showCenterNotice(\"视频已生成\"");
    expect(html).toContain("completedVideoNotifiedIds");
    expect(html).not.toContain("startVideoJobPolling();\n      }");
    expect(html).not.toContain("right: 20px");
    expect(html).not.toContain("bottom: 20px");
  });

  it("shows an immediate notice when video generation starts submitting", () => {
    const createVideoJobScript = html.match(/async function createVideoJob\(\) \{[\s\S]*?\n      \}/)?.[0] ?? "";
    const submittingNoticeIndex = createVideoJobScript.indexOf('showToast("正在提交生成任务，请稍候...")');
    const requestIndex = createVideoJobScript.indexOf('await apiFetch("/api/video/jobs"');
    expect(submittingNoticeIndex).toBeGreaterThan(-1);
    expect(requestIndex).toBeGreaterThan(-1);
    expect(submittingNoticeIndex).toBeLessThan(requestIndex);
    expect(createVideoJobScript).toContain('showToast("已提交生成任务")');
  });

  it("downloads videos as blobs and plays project videos inline on their cards", () => {
    expect(html).toContain("async function downloadSignedVideo(path, filename");
    expect(html).toContain("URL.createObjectURL(blob)");
    expect(html).toContain("link.download = filename");
    expect(html).toContain('class="project-player"');
    expect(html).toContain("asset.downloadUrl");
    expect(html).not.toContain("player.scrollIntoView");
  });

  it("removes prompt shortcut chips and the backend-parameter helper copy", () => {
    expect(html).not.toContain('class="chips"');
    expect(html).not.toContain("文生视频和图生视频合并为一个入口；视频生视频独立上传参考视频。");
    expect(html).not.toContain("可不上传图片直接文生视频");
    expect(html).not.toContain("作为视频生成的声音或节奏参考。");
    expect(html).not.toContain("仅视频生视频模式可上传");
    expect(html).not.toContain("展示所有已生成完成的视频，按生成时间倒序排列，最新视频在最上面最左边。");
    expect(html).not.toContain("电影感");
    expect(html).not.toContain("真实人像");
    expect(html).not.toContain("产品展示");
    expect(html).not.toContain("竖屏短视频");
    expect(html).not.toContain("接口参数由后台统一配置");
  });

  it("uploads reference media into generation payloads", () => {
    expect(html).toContain('data-upload-kind="image"');
    expect(html).toContain('data-upload-kind="video"');
    expect(html).toContain('data-upload-kind="audio"');
    expect(html).toContain('accept="image/*" multiple');
    expect(html).toContain('accept="video/*" multiple');
    expect(html).toContain('accept="audio/*"');
    expect(html).toContain("const REFERENCE_UPLOAD_LIMITS = { image: 4, video: 3, audio: 1 }");
    expect(html).toContain("selectedReferenceImages");
    expect(html).toContain("selectedReferenceVideos");
    expect(html).toContain("selectedReferenceAudios");
    expect(html).toContain("readFileAsDataUrl");
    expect(html).toContain("images: selectedReferenceImages");
    expect(html).toContain("videos: selectedReferenceVideos");
    expect(html).toContain("audios: selectedReferenceAudios");
  });

  it("places reference image or first frame and reference audio on the same row", () => {
    expect(html).toContain(".dropzone.image-ref {\n        grid-column: 1;");
    expect(html).toContain(".dropzone.audio-ref {\n        grid-column: 2;");
    expect(html).toContain("body.video-mode .dropzone.video-only {\n        display: block;\n        grid-column: 1;");
    expect(html).toContain("body.video-mode .dropzone.audio-ref {\n        grid-column: 2;");
    expect(html).not.toContain(".dropzone.image-ref,\n      .dropzone.audio-ref");
  });

  it("shows a real project empty state instead of static placeholder video cards", () => {
    const projectsSection = html.match(/<section class="view" id="view-projects">[\s\S]*?<section class="view" id="view-records">/)?.[0] ?? "";
    expect(projectsSection).toContain("data-project-grid");
    expect(projectsSection).toContain("project-empty");
    expect(projectsSection).not.toContain("thumb one");
    expect(projectsSection).not.toContain("thumb two");
    expect(projectsSection).not.toContain("thumb three");
    expect(projectsSection).not.toContain("城市天台镜头");
    expect(projectsSection).not.toContain("森林雾气氛围片段");
    expect(projectsSection).not.toContain("产品旋转展示");
    expect(html).toContain("projectGrid.classList.toggle(\"is-empty\", !projectVideos.length)");
  });

  it("compresses reference images before submitting them to the provider", () => {
    expect(html).toContain("const MAX_REFERENCE_IMAGE_EDGE = 1280");
    expect(html).toContain("const REFERENCE_IMAGE_QUALITY = 0.82");
    expect(html).toContain("async function prepareReferenceImage(file)");
    expect(html).toContain("canvas.toDataURL(\"image/jpeg\", REFERENCE_IMAGE_QUALITY)");
    expect(html).toContain("kind === \"image\" ? prepareReferenceImage(file) : readFileAsDataUrl(file)");
  });

  it("prevents oversized reference video and audio files before building JSON payloads", () => {
    expect(html).toContain("const MAX_REFERENCE_MEDIA_TOTAL_BYTES = 36 * 1024 * 1024");
    expect(html).toContain("let selectedReferenceMediaBytes = { video: [], audio: [] };");
    expect(html).toContain("function validateReferenceMediaSize(kind, files)");
    expect(html).toContain("selectedReferenceMediaBytes[kind] = files.map((file) => file.size || 0);");
    expect(html).toContain("if (!validateReferenceMediaSize(kind, files))");
    expect(html).toContain("setSelectedReferenceMediaBytes(kind, []);");
  });

  it("shows provider failure details on failed video jobs", () => {
    expect(html).toContain("function jobFailureDetail(job)");
    expect(html).toContain("job.errorMessage");
    expect(html).toContain('job.status === "FAILED" ? `<div class="tiny error-detail">${escapeHtml(jobFailureDetail(job))}</div>` : ""');
  });

  it("shows thumbnail previews after uploading reference images", () => {
    expect(html).toContain('data-image-preview-list');
    expect(html).toContain('class="upload-preview-list"');
    expect(html).toContain("function updateReferenceImagePreviews(items)");
    expect(html).toContain("items.map");
    expect(html).toContain('label.classList.toggle("has-preview", items.length > 0)');
    expect(html).toContain("updateReferenceImagePreviews(selectedReferenceImages.map((dataUrl, index) => ({");
  });

  it("switches generation modes silently", () => {
    const modeSwitchScript =
      html.match(/document\.querySelectorAll\("\[data-mode\]"\)\.forEach\(\(button\) => \{[\s\S]*?\n      \}\);/)?.[0] ??
      "";
    expect(modeSwitchScript).toContain('document.body.classList.toggle("video-mode", button.dataset.mode === "video")');
    expect(modeSwitchScript).not.toContain("showToast");
    expect(modeSwitchScript).not.toContain("showCenterNotice");
  });

  it("caps the visible task queue at ten items and aligns its bottom edge to generation settings", () => {
    expect(html).toContain("const MAX_VISIBLE_VIDEO_QUEUE_ITEMS = 10");
    expect(html).toContain('class="queue-scroll"');
    expect(html).toContain(".slice(0, MAX_VISIBLE_VIDEO_QUEUE_ITEMS)");
    expect(html).toContain("height: var(--queue-panel-height)");
    expect(html).toContain("min-height: var(--queue-panel-height)");
    expect(html).toContain("height: var(--queue-max-height)");
    expect(html).toContain("max-height: var(--queue-max-height)");
    expect(html).toContain("overflow-y: auto");
    expect(html).toContain("[data-video-queue-panel] .queue {");
    expect(html).toContain("min-height: 100%");
    expect(html).toContain("align-content: start");
    expect(html).toContain("scheduleQueueHeightSync()");
    expect(html).toContain("settingsPanelRect.bottom - queuePanelRect.top");
    expect(html).toContain("queuePanelRect = queuePanel.getBoundingClientRect()");
    expect(html).toContain("Math.max(0, settingsPanelRect.bottom - queuePanelRect.top)");
    expect(html).not.toContain("Math.max(128, settingsPanelRect.bottom - queuePanelRect.top)");
    expect(html).toContain("--queue-panel-height");
    expect(html).toContain("data-generation-settings-panel");
    expect(html).toContain("data-video-queue-panel");
    expect(html).toMatch(/<section class="panel" data-generation-settings-panel>\s*<div class="panel-header">\s*<h2>生成参数<\/h2>/);
  });

  it("adds a lightweight video generation records page without video asset fields", () => {
    expect(html).toContain('data-view-target="records"');
    expect(html).toContain('id="view-records"');
    expect(html).toContain("data-video-record-rows");
    expect(html).toContain("/api/video/job-records");
    expect(html).toContain("renderVideoRecords");
    expect(html).toContain("refreshVideoRecords");
    expect(html).toContain("modelName");
    expect(html).toContain("prompt");
    expect(html).toContain("resolution");
    expect(html).toContain("durationSeconds");
    expect(html).toContain("imageCount");
    expect(html).toContain("audioCount");
    expect(html).toContain("videoCount");
    expect(html).toContain("generationDurationSeconds");
    expect(html).toContain("costCredits");
    expect(html).not.toContain("<th>完成时间</th>");
    expect(html).not.toContain("formatDateTime(record.completedAt)");
    expect(html).not.toContain("record.downloadUrl");
    expect(html).not.toContain("record.storageKey");
    expect(html).not.toContain("record.providerTaskId");
    expect(html).not.toContain("只展示视频生成的基础流水信息，不保存视频地址或下载链接。");
  });

  it("uses custom select styling for generation parameter dropdowns", () => {
    expect(html).toContain("select-control");
    expect(html).toContain("background: #f8fbf9");
    expect(html).toContain("box-shadow: 0 0 0 3px rgba(29, 141, 116, 0.14)");
  });

  it("shows editable display names while submitting supplier model ids", () => {
    expect(html).toContain('<option value="${escapeHtml(model.modelName)}">${escapeHtml(model.displayName)}</option>');
    expect(html).toContain("model: model.modelName");
    expect(html).not.toContain("${escapeHtml(model.displayName)} / ${escapeHtml(model.modelName)}");
  });
});
