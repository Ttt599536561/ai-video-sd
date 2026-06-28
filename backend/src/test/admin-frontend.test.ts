import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("admin frontend shell", () => {
  const html = readFileSync(join(process.cwd(), "..", "admin.html"), "utf8");

  it("does not reveal admin controls before role verification", () => {
    expect(html).toContain("body.admin-ready");
    expect(html).toContain("/api/me");
    expect(html).toContain("user.role !== \"ADMIN\"");
  });

  it("loads and mutates admin data through backend APIs", () => {
    expect(html).toContain("/api/admin/model-configs");
    expect(html).toContain("/api/admin/provider-models");
    expect(html).toContain("/api/admin/credit-packages");
    expect(html).toContain("/api/admin/users");
    expect(html).toContain("/api/admin/video-jobs");
    expect(html).toContain("renderAdminModels");
    expect(html).toContain("renderAdminPackages");
    expect(html).toContain("renderAdminUsers");
    expect(html).toContain("renderAdminVideoJobs");
    expect(html).toContain("PATCH");
  });

  it("renders admin audit logs from the backend", () => {
    expect(html).toContain('data-admin-target="audit"');
    expect(html).toContain("/api/admin/audit-logs");
    expect(html).toContain("renderAdminAuditLogs");
    expect(html).toContain("data-audit-log-rows");
  });

  it("lets admins edit the public API base URL from system settings", () => {
    expect(html).toContain('data-admin-target="settings"');
    expect(html).toContain('id="admin-settings"');
    expect(html).toContain('id="publicApiBaseUrlInput"');
    expect(html).toContain("/api/admin/system-settings");
    expect(html).toContain("renderSystemSettings");
    expect(html).toContain("saveSystemSettings");
    expect(html).toContain('data-admin-action="save-settings"');
  });

  it("uses unified localized API error messages for admin failures", () => {
    expect(html).toContain("function apiErrorMessage");
    expect(html).toContain("FORBIDDEN");
    expect(html).toContain("MODEL_ALREADY_EXISTS");
    expect(html).toContain("CREDIT_PACKAGE_NOT_FOUND");
    expect(html).toContain("error.code = data?.code");
  });

  it("supports deleting configured models from the admin model list", () => {
    expect(html).toContain('data-admin-action="delete-model"');
    expect(html).toContain('apiFetch(`/api/admin/model-configs/${button.dataset.id}`, { method: "DELETE" })');
    expect(html).toContain("模型已删除");
  });

  it("shows explicit errors when model status or delete actions fail", () => {
    expect(html).toContain("更新模型状态失败");
    expect(html).toContain("删除模型失败");
  });

  it("uses empty model and package workbenches with a single save action", () => {
    expect(html).not.toContain('data-admin-action="new-model"');
    expect(html).not.toContain('data-admin-action="new-package"');
    expect(html).not.toMatch(/id="modelNameInput"[^>]*\svalue=/);
    expect(html).not.toMatch(/id="modelDisplayInput"[^>]*\svalue=/);
    expect(html).not.toMatch(/id="modelBaseUrlInput"[^>]*\svalue=/);
    expect(html).not.toMatch(/id="modelSubmitPathInput"[^>]*\svalue=/);
    expect(html).not.toMatch(/id="modelApiKeyInput"[^>]*\svalue=/);
    expect(html).not.toMatch(/id="modelCostInput"[^>]*\svalue=/);
    expect(html).not.toMatch(/id="packageNameInput"[^>]*\svalue=/);
    expect(html).not.toMatch(/id="packagePriceInput"[^>]*\svalue=/);
    expect(html).not.toMatch(/id="packageCreditsInput"[^>]*\svalue=/);
    expect(html).not.toMatch(/id="packageValidDaysInput"[^>]*\svalue=/);
    expect(html).not.toMatch(/id="packageSortOrderInput"[^>]*\svalue=/);
    expect(html).not.toMatch(/id="packagePurchaseUrlInput"[^>]*\svalue=/);
    expect(html).toContain("clearWorkbenchForTarget(target)");
    expect(html).toContain('document.querySelector("#packagePriceInput").value = "";');
    expect(html).toContain('document.querySelector("#packagePurchaseUrlInput").value = "";');
    expect(html).toContain('document.querySelector("#modelBaseUrlInput").value = "";');
  });

  it("switches admin sections without showing system notices", () => {
    const navStart = html.indexOf('document.querySelectorAll("[data-admin-target]")');
    const navEnd = html.indexOf('document.querySelectorAll("select")', navStart);
    const navScript = html.slice(navStart, navEnd);

    expect(navScript).toContain("clearWorkbenchForTarget(target)");
    expect(navScript).not.toContain("showToast");
    expect(html).not.toContain("已切换到");
  });

  it("lets admins configure purchase URLs for credit packages", () => {
    expect(html).toContain('id="packagePurchaseUrlInput"');
    expect(html).toContain("purchaseUrl: document.querySelector(\"#packagePurchaseUrlInput\").value.trim()");
    expect(html).toContain('document.querySelector("#packagePurchaseUrlInput").value = pkg.purchaseUrl || "";');
    expect(html).toContain("pkg.purchaseUrl");
  });

  it("renders supplier model names as suggestions while allowing manual model ids", () => {
    expect(html).toContain('<input id="modelNameInput"');
    expect(html).toContain('list="providerModelOptions"');
    expect(html).toContain('<datalist id="providerModelOptions">');
    expect(html).toContain("loadProviderModels");
    expect(html).toContain("renderProviderModelOptions");
    expect(html).toContain("从供应商读取模型名称失败");
    expect(html).toContain('placeholder="/v1/videos"');
  });

  it("starts redemption-code inputs empty", () => {
    expect(html).not.toMatch(/id="redeemBatchName"[^>]*\svalue=/);
    expect(html).not.toMatch(/id="redeemBatchQuantity"[^>]*\svalue=/);
    expect(html).not.toMatch(/id="redeemBatchCredits"[^>]*\svalue=/);
    expect(html).not.toMatch(/id="redeemBatchValidityDays"[^>]*\svalue=/);
  });

  it("uses custom validity days or permanent validity for redemption batches", () => {
    const redemptionView = html.slice(html.indexOf('id="admin-redemption"'), html.indexOf('id="admin-records"'));

    expect(redemptionView).toContain('<option value="permanent" selected>永久有效</option>');
    expect(redemptionView).toContain('<option value="custom">自定义天数</option>');
    expect(redemptionView).toContain('id="redeemBatchValidityDays"');
    expect(redemptionView).toContain('type="number"');
    expect(redemptionView).not.toContain('type="datetime-local"');
    expect(html).toContain("const validityDaysRaw = document.querySelector(\"#redeemBatchValidityDays\").value;");
    expect(html).toContain("expiresAt: validity === \"custom\" ? expiresAtFromValidityDays(validityDays).toISOString() : null");
  });

  it("shows all generated redemption-code records and opens a copyable modal after generation", () => {
    const redemptionView = html.slice(html.indexOf('id="admin-redemption"'), html.indexOf('id="admin-records"'));

    expect(redemptionView).not.toContain("data-copy-generated-codes");
    expect(redemptionView).toContain("redemption-layout");
    expect(redemptionView).not.toContain('<div class="grid">');
    expect(redemptionView).toContain("data-redemption-pagination");
    expect(redemptionView).toContain("redemption-table-shell");
    expect(redemptionView).toContain("<th>有效期</th>");
    expect(html).toContain("height: 520px");
    expect(html).toContain("renderRedemptionPagination");
    expect(html).toContain("REDEMPTION_PAGE_SIZE");
    expect(html).toContain("/api/admin/redemption-codes");
    expect(html).toContain("renderAdminRedemptionCodes");
    expect(html).toContain('data-redemption-code-rows');
    expect(html).toContain("全部兑换码记录");
    expect(html).toContain("showGeneratedCodeModal(result.codes)");
    expect(html).toContain("data-generated-code-modal");
    expect(html).toContain("data-copy-generated-modal-codes");
    expect(html).toContain('document.querySelector("#generatedCodeModalList").value = generatedCodes.map((code) => code.plainCode).join("\\n");');
    expect(html).toContain("copyText(code.plainCode)");
    expect(html).not.toContain("code.codeCiphertext");
  });

  it("shows admin system notices in a centered modal instead of a bottom toast", () => {
    expect(html).toContain('class="center-notice"');
    expect(html).toContain("function showCenterNotice");
    expect(html).toContain("showCenterNotice(\"提示\", message");
    expect(html).not.toContain('class="toast"');
    expect(html).not.toContain("right: 20px");
    expect(html).not.toContain("bottom: 20px");
  });

  it("renders admin video records with readable metadata instead of model ids", () => {
    expect(html).toContain("job.modelName");
    expect(html).toContain("job.prompt");
    expect(html).toContain("job.durationSeconds");
    expect(html).toContain("job.imageCount");
    expect(html).toContain("job.videoCount");
    expect(html).toContain("job.audioCount");
    expect(html).toContain("job.generationDurationSeconds");
    expect(html).not.toContain("<td>${escapeHtml(job.modelConfigId)}</td>");
  });

  it("shows explicit errors when package status or delete actions fail", () => {
    expect(html).toContain("更新套餐状态失败");
    expect(html).toContain("删除套餐失败");
  });

  it("does not send a JSON content type for bodyless admin requests", () => {
    expect(html).not.toContain('"Content-Type": "application/json",\n          ...(options.headers || {})');
    expect(html).toContain('if (options.body !== undefined && !headers["Content-Type"])');
    expect(html).toContain('headers["Content-Type"] = "application/json";');
  });
});
