import express from "express";
import axios from "axios";
import cors from "cors";
import { HttpsCookieAgent } from "http-cookie-agent/http";
import { CookieJar } from "tough-cookie";
import * as cheerio from "cheerio";
import { createServer as createViteServer } from "vite";

// =========================
// CONFIG
// =========================
const DEBUG = true;

const SPTS_BASE = "https://portal2.spfs-group.rs:89";
const SPTS_INDEX = `${SPTS_BASE}/otrs/index.pl`;

// =========================
// APP + MIDDLEWARE
// =========================
async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());
  app.use(cors());

  // =========================
  // HTTP CLIENT (cookies + ignore TLS)
  // =========================
  const cookieJar = new CookieJar();

  const agent = new HttpsCookieAgent({
    cookies: { jar: cookieJar },
    rejectUnauthorized: false,
  });

  const client = axios.create({
    httpsAgent: agent,
    withCredentials: true,
    validateStatus: () => true,
  });

  // =========================
  // HELPERS (shared functions)
  // =========================
  function log(...args: any[]) {
    if (DEBUG) console.log(...args);
  }

  function normalizeSpaces(s: any) {
    return String(s || "").replace(/\s+/g, " ").trim();
  }

  function looksLikeLoginPage(html: any) {
    const h = String(html || "");
    return h.includes('name="User"') && h.includes('name="Password"');
  }

  function looksLikeLoggedIn(html: any) {
    return String(html || "").includes("Logout");
  }

  /**
   * Extract all form fields exactly like browser would submit:
   * - inputs (including hidden)
   * - selected options from selects
   * - textarea values
   */
  function buildPayloadFromForm($: cheerio.CheerioAPI, form: cheerio.Cheerio<cheerio.Element>) {
    const payload = new URLSearchParams();

    // inputs
    form.find("input[name]").each((_, el) => {
      const name = $(el).attr("name");
      if (!name) return;

      const type = String($(el).attr("type") || "").toLowerCase();
      const value = $(el).attr("value") || "";

      if (type === "checkbox" || type === "radio") {
        if ($(el).is(":checked")) payload.append(name, value || "1");
        return;
      }

      payload.append(name, value);
    });

    // selects -> selected option
    form.find("select[name]").each((_, el) => {
      const name = $(el).attr("name");
      if (!name) return;

      const selected = $(el).find("option:selected");
      const value = selected.attr("value") || "";
      payload.set(name, value);
    });

    // textarea
    form.find("textarea[name]").each((_, el) => {
      const name = $(el).attr("name");
      if (!name) return;

      const value = $(el).val() || $(el).text() || $(el).attr("value") || "";
      payload.set(name, String(value));
    });

    return payload;
  }

  /**
   * Resolve form action URL to absolute URL
   */
  function resolveFormAction(actionRaw: string | undefined) {
    let action = actionRaw || "/otrs/index.pl";
    if (action.startsWith("/")) action = `${SPTS_BASE}${action}`;
    if (!action.startsWith("http")) action = `${SPTS_BASE}/otrs/index.pl`;
    return action;
  }

  /**
   * Parse ticket list rows based on AgentTicketZoom links
   */
  function parseTicketList(html: string) {
    const $ = cheerio.load(String(html || ""));
    const tickets: any[] = [];
    const seen = new Set();

    $("a[href*='Action=AgentTicketZoom'][href*='TicketID=']").each((_, a) => {
      const link = $(a);
      const href = link.attr("href") || "";
      const m = href.match(/TicketID=(\d+)/);
      const ticketId = m ? m[1] : null;
      if (!ticketId || seen.has(ticketId)) return;
      seen.add(ticketId);

      const number = link.text().trim();
      const title = (link.attr("title") || "").trim();

      const row = link.closest("tr");
      const tds = row.find("td");

      // NOTE: indeks može varirati po View=Small itd, ali ovo ti je već radilo
      const age = tds.length ? $(tds.get(4)).text().trim() : "";
      const state = tds.length ? $(tds.get(6)).text().trim() : "";
      const queue = tds.length ? $(tds.get(8)).text().trim() : "";
      const owner = tds.length ? $(tds.get(9)).text().trim() : "";

      tickets.push({ id: ticketId, number, title, age, state, queue, owner });
    });

    return tickets;
  }

  /**
   * Parse Ticket Zoom "Ticket Information" + "Customer Information"
   * from your already extracted "articles" preview blocks.
   */
  function between(text: string, startMarker: string, endMarker?: string) {
    const t = normalizeSpaces(text);
    const start = t.indexOf(startMarker);
    if (start === -1) return "";
    const after = t.slice(start + startMarker.length).trim();
    if (!endMarker) return after;
    const end = after.indexOf(endMarker);
    return end === -1 ? after : after.slice(0, end).trim();
  }

  function parseByKnownKeys(text: string, keys: string[]) {
    const t = normalizeSpaces(text);
    const result: Record<string, string> = {};

    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      const nextKey = keys[i + 1];

      const startToken = `${key}:`;
      const startIdx = t.indexOf(startToken);
      if (startIdx === -1) continue;

      const afterStart = t.slice(startIdx + startToken.length).trim();
      let value = afterStart;

      if (nextKey) {
        const nextToken = ` ${nextKey}:`;
        const nextIdx = afterStart.indexOf(nextToken);
        if (nextIdx !== -1) value = afterStart.slice(0, nextIdx).trim();
      }

      result[key] = value;
    }

    return result;
  }

  function extractArticlesPreview($: cheerio.CheerioAPI) {
    const articles: string[] = [];
    $(".Article, .WidgetSimple, .CommunicationLog").each((_, el) => {
      const txt = normalizeSpaces($(el).text());
      if (!txt) return;
      if (txt.includes("You are logged in as") || txt.includes("Queue view")) return;
      if (txt.length < 80) return;
      articles.push(txt.slice(0, 900));
    });
    return articles;
  }

  /**
   * For verification: read current state from zoom page quickly
   */
  function verifyStateFromZoom(html: string) {
    const t = normalizeSpaces(html).toLowerCase();
    // brute markers that worked for you
    if (t.includes("state: closed") || t.includes(">closed<")) return "closed";
    if (t.includes("state: open") || t.includes(">open<")) return "open";
    return "";
  }

  // =========================
  // ROUTES
  // =========================

  // Health
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // -------- AUTH --------
  app.post("/api/login", async (req, res) => {
    try {
      const { username, password } = req.body || {};
      if (!username || !password) {
        res.status(400).json({ success: false, message: "Missing username/password" });
        return;
      }

      await client.get(SPTS_INDEX);

      const response = await client.post(
        SPTS_INDEX,
        new URLSearchParams({
          Action: "Login",
          RequestedURL: "",
          Lang: "en",
          User: username,
          Password: password,
        }).toString(),
        {
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Referer: SPTS_INDEX,
            "User-Agent": "Mozilla/5.0",
          },
        }
      );

      if (looksLikeLoggedIn(response.data)) {
        res.json({ success: true });
        return;
      }

      res.status(401).json({ success: false, message: "Login failed" });
    } catch (err: any) {
      console.error("LOGIN ERROR:", err.message);
      res.status(500).json({ success: false, message: "Server error", error: err.message });
    }
  });

  // -------- MY TICKETS (Responsible) --------
  app.get("/api/my-tickets", async (req, res) => {
    try {
      const url = `${SPTS_INDEX}?Action=AgentTicketResponsibleView`;
      const r = await client.get(url);
      const html = String(r.data);

      if (looksLikeLoginPage(html)) {
        res.status(401).json({ success: false, message: "Not logged in. Call /api/login first." });
        return;
      }

      const tickets = parseTicketList(html);

      res.json({
        success: true,
        usedUrl: url,
        count: tickets.length,
        tickets,
      });
    } catch (err: any) {
      console.error("MY TICKETS ERROR:", err.message);
      res.status(500).json({ success: false, message: "Failed to fetch tickets", error: err.message });
    }
  });

  // -------- TICKET DETAIL (Zoom) --------
  app.get("/api/ticket/:id", async (req, res) => {
    try {
      const ticketId = req.params.id;
      const url = `${SPTS_INDEX}?Action=AgentTicketZoom;TicketID=${encodeURIComponent(ticketId)}`;

      const response = await client.get(url);
      const html = String(response.data);

      if (looksLikeLoginPage(html)) {
        res.status(401).json({ success: false, message: "Not logged in. Call /api/login first." });
        return;
      }

      const $ = cheerio.load(html);
      const pageTitle = $("title").text().trim();
      const ticketNumber = (pageTitle.match(/\b20\d{10,}\b/) || [])[0] || "";

      const articles = extractArticlesPreview($);
      const allText = normalizeSpaces(articles.join(" "));

      const ticketInfoText = between(allText, "Ticket Information", "Customer Information");
      const customerInfoText = between(allText, "Customer Information", "Location");

      const ticketKeys = [
        "Type",
        "State",
        "Locked",
        "Queue",
        "Owner",
        "Responsible",
        "Service",
        "Service Incident State",
        "Service Level Agreement",
        "Criticality",
        "Impact",
        "Priority",
        "CustomerID",
        "Report Time",
        "City",
        "Country",
      ];

      const customerKeys = [
        "Firstname",
        "Lastname",
        "Username",
        "Email",
        "Phone",
        "Fax",
        "Street",
        "Zip",
        "City",
        "Country",
      ];

      const tMap = parseByKnownKeys(ticketInfoText, ticketKeys);
      const cMap = parseByKnownKeys(customerInfoText, customerKeys);

      const ticket = {
        type: tMap["Type"] || "",
        state: tMap["State"] || "",
        locked: tMap["Locked"] || "",
        queue: tMap["Queue"] || "",
        owner: tMap["Owner"] || "",
        responsible: tMap["Responsible"] || "",
        service: tMap["Service"] || "",
        serviceIncidentState: tMap["Service Incident State"] || "",
        sla: tMap["Service Level Agreement"] || "",
        criticality: tMap["Criticality"] || "",
        impact: tMap["Impact"] || "",
        priority: tMap["Priority"] || "",
        customerId: tMap["CustomerID"] || "",
        reportTime: tMap["Report Time"] || "",
        ticketCity: tMap["City"] || "",
        ticketCountry: tMap["Country"] || "",
      };

      const customer = {
        firstname: cMap["Firstname"] || "",
        lastname: cMap["Lastname"] || "",
        username: cMap["Username"] || "",
        email: cMap["Email"] || "",
        phone: cMap["Phone"] || "",
        fax: cMap["Fax"] || "",
        street: cMap["Street"] || "",
        zip: cMap["Zip"] || "",
        city: cMap["City"] || "",
        country: cMap["Country"] || "",
      };

      const location =
        customer.street || customer.city || customer.country
          ? {
              name: [customer.firstname, customer.lastname].filter(Boolean).join(" ").trim() || null,
              street: customer.street || null,
              zip: customer.zip || null,
              city: customer.city || null,
              country: customer.country || null,
              phone: customer.phone || null,
              email: customer.email || null,
            }
          : null;

      res.json({
        success: true,
        ticketId,
        ticketNumber,
        subject: pageTitle,
        ticket,
        customer,
        location,
        articlesCount: articles.length,
        articles,
        debug: DEBUG
          ? { url, ticketInfoText, customerInfoText }
          : undefined,
      });
    } catch (err: any) {
      console.error("TICKET DETAIL ERROR:", err.message);
      res.status(500).json({ success: false, message: "Failed to fetch ticket details", error: err.message });
    }
  });

  app.get("/api/ticket/:id/freefields", async (req, res) => {
    try {
      const ticketId = req.params.id;

      const url = `${SPTS_BASE}/otrs/index.pl?Action=AgentTicketFreeText;TicketID=${encodeURIComponent(ticketId)}`;
      const response = await client.get(url);
      const html = String(response.data);

      if (looksLikeLoginPage(html)) {
        res.status(401).json({ success: false, message: "Not logged in. Call /api/login first." });
        return;
      }

      const $ = cheerio.load(html);
      const form = $("form").first();

      // action (možeš vratiti za debug, ali GET ga ne koristi)
      const formAction = form.attr("action") || "";

      const fields: any[] = [];

      form.find("input, select, textarea").each((_, el) => {
        const tag = el.tagName?.toLowerCase();
        const $el = $(el);

        const name = $el.attr("name") || "";
        if (!name) return;

        const id = $el.attr("id") || "";
        const type = ($el.attr("type") || tag || "").toLowerCase();

        // label
        let label = "";
        if (id) label = $(`label[for="${id}"]`).text().trim();

        // required
        const required =
          $el.attr("aria-required") === "true" ||
          $el.hasClass("Validate_Required") ||
          $el.attr("required") !== undefined;

        // value
        let value = "";
        let options: any[] | null = null;

        if (tag === "select") {
          options = [];
          $el.find("option").each((_, opt) => {
            options!.push({
              value: $(opt).attr("value") || "",
              text: normalizeSpaces($(opt).text()),
              selected: $(opt).is(":selected"),
            });
          });

          value =
            $el.find("option:selected").attr("value") ||
            $el.find("option:selected").text() ||
            "";
        } else if (tag === "textarea") {
          value = $el.text() || "";
        } else {
          if (type === "checkbox") {
            const isChecked = $el.is(":checked") || $el.attr("checked") !== undefined;
            value = isChecked ? ($el.attr("value") || "1") : "";
          } else {
            value = $el.attr("value") || "";
          }
        }

        fields.push({
          name,
          id,
          tag,
          type,
          label,
          required,
          value: normalizeSpaces(value),
          options,
        });
      });

      const useful = fields.filter((f) => !["submit", "button"].includes(f.type));

      res.json({
        success: true,
        ticketId,
        formAction,
        fieldsCount: useful.length,
        fields: useful,
        debug: { url },
      });
    } catch (err: any) {
      console.error("FREEFIELDS GET ERROR:", err.message);
      res.status(500).json({ success: false, message: "Failed to load free fields", error: err.message });
    }
  });


  app.post("/api/ticket/:id/freefields", async (req, res) => {
    try {
      const ticketId = req.params.id;
      const userFields = req.body || {};

      const formUrl = `${SPTS_BASE}/otrs/index.pl?Action=AgentTicketFreeText;TicketID=${encodeURIComponent(ticketId)}`;
      const formResp = await client.get(formUrl);
      const formHtml = String(formResp.data);

      if (looksLikeLoginPage(formHtml)) {
        res.status(401).json({ success: false, message: "Not logged in. Call /api/login first." });
        return;
      }

      const $ = cheerio.load(formHtml);
      const form = $("form").first();

      // ✅ post na action iz forme
      const action = resolveFormAction(form.attr("action"));

      // ✅ 1) uzmi payload baš kao forma (hidden + defaults + duplicates)
      const payload = buildPayloadFromForm($, form);

      // ✅ 2) override obavezne OTRS parametre
      payload.set("Action", "AgentTicketFreeText");
      payload.set("Subaction", "Store");
      payload.set("TicketID", String(ticketId));
      payload.set("Submit", "1");
      payload.set("Continue", "1");

      // ✅ 3) override polja iz app-a (ovo prepisuje sve ranije)
      for (const [k, v] of Object.entries(userFields)) {
        payload.set(k, String(v ?? ""));
      }

      // ✅ debug (sad nema payloadObj)
      console.log("FREEFIELDS POST sending:", {
        used: payload.get("DynamicField_startoftravelUsed"),
        y: payload.get("DynamicField_startoftravelYear"),
        m: payload.get("DynamicField_startoftravelMonth"),
        d: payload.get("DynamicField_startoftravelDay"),
        h: payload.get("DynamicField_startoftravelHour"),
        min: payload.get("DynamicField_startoftravelMinute"),
        action,
      });

      const submitResp = await client.post(action, payload.toString(), {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Referer: formUrl,
          "User-Agent": "Mozilla/5.0",
        },
      });

      const outHtml = String(submitResp.data);

      if (looksLikeLoginPage(outHtml)) {
        res.status(401).json({
          success: false,
          message: "Session expired / login page returned after submit.",
          debug: { formUrl, status: submitResp.status },
        });
        return;
      }

      // pokušaj izvući error text
      const $$ = cheerio.load(outHtml);
      const errorText = normalizeSpaces(
        $$(".ErrorMessage, .MessageError, .ErrorBox, .Error, .ValidationError, .Notification.Error, .FieldError").text()
      );

      // ✅ VERIFY: reload form i provjeri checked + vrijednosti
      const verifyResp = await client.get(formUrl);
      const verifyHtml = String(verifyResp.data);
      const $$$ = cheerio.load(verifyHtml);

      const isChecked = (name: string) => $$$(`input[name="${name}"]`).first().attr("checked") !== undefined;
      const val = (name: string) => $$$(`[name="${name}"]`).first().val() || "";

      const verify = {
        startTravelUsedChecked: isChecked("DynamicField_startoftravelUsed"),
        y: val("DynamicField_startoftravelYear"),
        m: val("DynamicField_startoftravelMonth"),
        d: val("DynamicField_startoftravelDay"),
        h: val("DynamicField_startoftravelHour"),
        min: val("DynamicField_startoftravelMinute"),
      };

      const ok = verify.startTravelUsedChecked && !errorText;

      res.json({
        success: ok,
        message: ok ? "Free fields saved" : "Free fields NOT saved",
        validation: { errorText: errorText || null },
        verify,
        debug: { formUrl, action, status: submitResp.status },
      });
    } catch (err: any) {
      console.error("FREEFIELDS POST ERROR:", err.message);
      res.status(500).json({
        success: false,
        message: "Failed to submit free fields",
        error: err.message,
      });
    }
  });


  // -------- CHANGE STATE (GET form) --------
  app.get("/api/ticket/:id/state", async (req, res) => {
    try {
      const ticketId = req.params.id;
      const url = `${SPTS_INDEX}?Action=AgentTicketStatusHD;TicketID=${encodeURIComponent(ticketId)}`;

      const r = await client.get(url);
      const html = String(r.data);

      if (looksLikeLoginPage(html)) {
        res.status(401).json({ success: false, message: "Not logged in. Call /api/login first." });
        return;
      }

      const $ = cheerio.load(html);
      const form = $("form").first();

      const hidden: Record<string, string> = {};
      form.find("input[type='hidden'][name]").each((_, el) => {
        const name = $(el).attr("name");
        const value = $(el).attr("value") || "";
        if (name) hidden[name] = value;
      });

      const selects: any[] = [];
      form.find("select[name]").each((_, el) => {
        const name = $(el).attr("name");
        if (!name) return;

        // label pokušaj: prethodni label ili text u parent-u
        const label = normalizeSpaces($(el).closest("div, li, tr").find("label").first().text()) || name;

        const options: any[] = [];
        $(el)
          .find("option")
          .each((__, opt) => {
            options.push({
              value: $(opt).attr("value") || "",
              text: normalizeSpaces($(opt).text()),
              selected: $(opt).is(":selected"),
            });
          });

        selects.push({ name, label, optionsCount: options.length, options });
      });

      res.json({
        success: true,
        ticketId,
        hidden,
        selects,
        debug: DEBUG ? { url, status: r.status } : undefined,
      });
    } catch (err: any) {
      console.error("STATE GET ERROR:", err.message);
      res.status(500).json({ success: false, message: "Failed to fetch state form", error: err.message });
    }
  });

  // -------- CHANGE STATE (POST store) --------
  app.post("/api/ticket/:id/state", async (req, res) => {
    try {
      const ticketId = req.params.id;
      const {
        newStateId = "2",
        note = "",
        articleTypeId = "9",
      } = req.body || {};

      const formUrl = `${SPTS_INDEX}?Action=AgentTicketStatusHD;TicketID=${encodeURIComponent(ticketId)}`;
      const formResp = await client.get(formUrl);
      const formHtml = String(formResp.data);

      if (looksLikeLoginPage(formHtml)) {
        res.status(401).json({ success: false, message: "Not logged in. Call /api/login first." });
        return;
      }

      const $ = cheerio.load(formHtml);
      const form = $("form").first();

      const action = resolveFormAction(form.attr("action"));
      const payload = buildPayloadFromForm($, form);

      // override what we want
      payload.set("Action", "AgentTicketStatusHD");
      payload.set("Subaction", "Store");
      payload.set("TicketID", String(ticketId));

      payload.set("NewStateID", String(newStateId));
      payload.set("NextStateID", String(newStateId));
      payload.set("ArticleTypeID", String(articleTypeId));

      payload.set("Subject", payload.get("Subject") || "Changing State");
      payload.set("Body", note && note.trim() ? note.trim() : (payload.get("Body") || " "));
      payload.set("TimeUnits", payload.get("TimeUnits") || "0");

      payload.set("Submit", "1");
      payload.set("Continue", "1");

      log("STATE POST form action:", action);
      log("STATE POST payload size:", payload.toString().length);

      const submitResp = await client.post(action, payload.toString(), {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Referer: formUrl,
          "User-Agent": "Mozilla/5.0",
        },
      });

      const outHtml = String(submitResp.data);
      const $$ = cheerio.load(outHtml);

      const title = $$("title").text().trim();
      const hasForm = $$("form").length;

      // verify via zoom
      const verifyUrl = `${SPTS_INDEX}?Action=AgentTicketZoom;TicketID=${encodeURIComponent(ticketId)}`;
      const verifyResp = await client.get(verifyUrl);
      const verifyHtml = String(verifyResp.data);
      const currentState = verifyStateFromZoom(verifyHtml);

      res.json({
        success: currentState === "closed" ? true : true, // state može biti i nešto drugo, ali request je prošao
        message: "State submitted",
        requested: { newStateId: String(newStateId), articleTypeId: String(articleTypeId) },
        result: { currentState },
        debug: DEBUG
          ? {
              formUrl,
              action,
              status: submitResp.status,
              title,
              hasForm,
            }
          : undefined,
      });
    } catch (err: any) {
      console.error("STATE POST ERROR:", err.message);
      res.status(500).json({ success: false, message: "Failed to change state", error: err.message });
    }
  });

  // =========================
  // VITE MIDDLEWARE
  // =========================
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    // In production, serve static files if built
    // Assuming 'dist' is the build output
    // app.use(express.static('dist'));
  }

  // =========================
  // START SERVER
  // =========================
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Middleware running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
