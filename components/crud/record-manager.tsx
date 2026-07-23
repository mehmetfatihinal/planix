"use client";

import { useState } from "react";
import { Building2, ClipboardList, FileText, Package, ReceiptText, StickyNote, Trash2, Upload, Workflow } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useAppState } from "@/lib/app-state";
import { isoDate } from "@/lib/format";
import { Button, Card, EmptyState, SectionTitle } from "@/components/ui/ui-kit";
import type { Company, Task } from "@/types/business";

type Tab = "company" | "task" | "note" | "product" | "offer" | "invoice" | "document" | "module";

export function RecordManager() {
  const { t } = useAppState();
  const [tab, setTab] = useState<Tab>("company");
  const tabs: Array<[Tab, string]> = [
    ["company", t("common.company")],
    ["task", t("actions.createTask")],
    ["note", t("actions.addNote")],
    ["product", t("products.title")],
    ["offer", t("actions.createOffer")],
    ["invoice", t("actions.createInvoice")],
    ["document", t("actions.uploadDocument")],
    ["module", t("sidebar.workModules")]
  ];

  return (
    <Card>
      <SectionTitle title="Create / Edit Records" subtitle="All records are saved to your logged-in backend account." icon={Workflow} />
      <div className="premium-scroll mb-5 flex gap-2 overflow-x-auto">
        {tabs.map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`shrink-0 rounded-xl px-3 py-2 text-sm font-medium transition ${
              tab === id
                ? "bg-primary text-white dark:bg-darkPrimary"
                : "border border-[#E5D8C7] bg-white text-muted hover:text-primary dark:border-darkBorder dark:bg-[#202020] dark:text-darkMuted"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "company" ? <CompanyForm /> : null}
      {tab === "task" ? <TaskForm /> : null}
      {tab === "note" ? <NoteForm /> : null}
      {tab === "product" ? <ProductForm /> : null}
      {tab === "offer" ? <OfferForm /> : null}
      {tab === "invoice" ? <InvoiceForm /> : null}
      {tab === "document" ? <DocumentForm /> : null}
      {tab === "module" ? <ModuleForm /> : null}
    </Card>
  );
}

function CompanyForm() {
  const { data, createCompany, updateCompany, deleteCompany } = useAppState();
  const [editingId, setEditingId] = useState("");
  const editing = data.companies.find((item) => item.id === editingId);
  const [name, setName] = useState("");
  const [contactPerson, setContactPerson] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");

  function load(company: Company) {
    setEditingId(company.id);
    setName(company.name);
    setContactPerson(company.contactPerson);
    setPhone(company.phone);
    setEmail(company.email);
    setAddress(company.address);
  }

  async function save() {
    const payload = { ...(editing ?? {}), name, contactPerson, phone, email, address, status: editing?.status ?? "new" } as Partial<Company>;
    if (editing) await updateCompany(editing.id, payload);
    else await createCompany(payload);
    setEditingId("");
    setName("");
    setContactPerson("");
    setPhone("");
    setEmail("");
    setAddress("");
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
      <div className="grid gap-3 sm:grid-cols-2">
        <Input label="Company name" value={name} onChange={setName} />
        <Input label="Contact person" value={contactPerson} onChange={setContactPerson} />
        <Input label="Phone" value={phone} onChange={setPhone} />
        <Input label="Email" value={email} onChange={setEmail} />
        <div className="sm:col-span-2"><Input label="Address" value={address} onChange={setAddress} /></div>
        <Button onClick={save} disabled={!name}>{editing ? "Update company" : "Create company"}</Button>
      </div>
      <RecordList
        icon={Building2}
        empty="No companies yet."
        items={data.companies.map((company) => ({
          id: company.id,
          title: company.name,
          subtitle: company.contactPerson || company.address,
          onEdit: () => load(company),
          onDelete: () => deleteCompany(company.id)
        }))}
      />
    </div>
  );
}

function TaskForm() {
  const { data, t, createTask, updateTask, deleteTask } = useAppState();
  const [editingId, setEditingId] = useState("");
  const editing = data.tasks.find((item) => item.id === editingId);
  const [title, setTitle] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [moduleId, setModuleId] = useState(data.modules[0]?.id ?? "");
  const [dueDate, setDueDate] = useState(isoDate(0));
  const [undated, setUndated] = useState(false);

  function load(task: Task) {
    setEditingId(task.id);
    setTitle(task.title);
    setCompanyId(task.companyId ?? "");
    setModuleId(task.moduleIds[0] ?? data.modules[0]?.id ?? "");
    setUndated(!task.dueDate);
    setDueDate(task.dueDate ?? isoDate(0));
  }

  async function save() {
    const payload = {
      ...(editing ?? {}),
      title,
      companyId: companyId || null,
      moduleIds: [moduleId || data.modules[0]?.id || "module-todo"],
      // Undated toggle (or an empty date) submits a real time-less task: no
      // dueDate, and clear any time/reminder so no alert can fire.
      dueDate: undated || !dueDate ? null : dueDate,
      ...(undated ? { dueTime: null, timeWindow: null, reminderInterval: null } : {}),
      type: data.modules.find((item) => item.id === moduleId)?.type ?? "todo"
    } as Partial<Task>;
    if (editing) await updateTask(editing.id, payload);
    else await createTask(payload);
    setEditingId("");
    setTitle("");
    setUndated(false);
    setDueDate(isoDate(0));
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
      <div className="grid gap-3 sm:grid-cols-2">
        <Input label="Task title" value={title} onChange={setTitle} />
        <Select label="Company" value={companyId} onChange={setCompanyId} options={[["", "No company"], ...data.companies.map((item) => [item.id, item.name] as [string, string])]} />
        <Select label="Module" value={moduleId} onChange={setModuleId} options={data.modules.map((item) => [item.id, item.name] as [string, string])} />
        <Input label="Due date" value={undated ? "" : dueDate} onChange={setDueDate} type="date" disabled={undated} />
        <label className="flex items-center gap-2 text-sm text-muted dark:text-darkMuted sm:col-span-2">
          <input
            type="checkbox"
            checked={undated}
            onChange={(event) => setUndated(event.target.checked)}
            className="h-4 w-4 rounded border-[#E5D8C7] text-primary focus:ring-primary/40 dark:border-darkBorder"
          />
          {t("form.undatedToggle")}
        </label>
        <Button onClick={save} disabled={!title}>{editing ? "Update task" : "Create task"}</Button>
      </div>
      <RecordList
        icon={ClipboardList}
        empty="No tasks yet."
        items={data.tasks.map((task) => ({
          id: task.id,
          title: task.title,
          subtitle: task.dueDate ?? t("task.noDate"),
          onEdit: () => load(task),
          onDelete: () => deleteTask(task.id)
        }))}
      />
    </div>
  );
}

function NoteForm() {
  const { data, createNote } = useAppState();
  const [companyId, setCompanyId] = useState("");
  const [content, setContent] = useState("");
  return (
    <SimpleCreate
      icon={StickyNote}
      empty="No notes yet."
      list={data.notes.map((item) => ({ id: item.id, title: item.content, subtitle: item.sourceType }))}
      form={
        <>
          <Select label="Company" value={companyId} onChange={setCompanyId} options={[["", "No company"], ...data.companies.map((item) => [item.id, item.name] as [string, string])]} />
          <Textarea label="Note" value={content} onChange={setContent} />
          <Button onClick={() => createNote({ companyId: companyId || null, content }).then(() => setContent(""))} disabled={!content}>Create note</Button>
        </>
      }
    />
  );
}

function ProductForm() {
  const { data, createProduct } = useAppState();
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [price, setPrice] = useState("0");
  return (
    <SimpleCreate
      icon={Package}
      empty="No products yet."
      list={data.products.map((item) => ({ id: item.id, title: item.name, subtitle: item.category }))}
      form={
        <>
          <Input label="Product name" value={name} onChange={setName} />
          <Input label="Category" value={category} onChange={setCategory} />
          <Input label="Selling price" value={price} onChange={setPrice} type="number" />
          <Button onClick={() => createProduct({ name, category, sellingPrice: Number(price), minimumPrice: Number(price) }).then(() => setName(""))} disabled={!name}>Create product</Button>
        </>
      }
    />
  );
}

interface OfferLineDraft {
  key: string;
  productId: string;
  productName: string;
  quantity: string;
  unitPrice: string;
}

function emptyOfferLine(): OfferLineDraft {
  return { key: crypto.randomUUID(), productId: "", productName: "", quantity: "1", unitPrice: "0" };
}

function OfferForm() {
  const { data, t, createOffer, sendOffer, acceptOffer, convertOfferToInvoice, deleteOffer } = useAppState();
  const [companyId, setCompanyId] = useState("");
  const [title, setTitle] = useState("");
  const [lines, setLines] = useState<OfferLineDraft[]>([emptyOfferLine()]);

  function patchLine(key: string, patch: Partial<OfferLineDraft>) {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  }

  function selectProduct(key: string, productId: string) {
    const product = data.products.find((item) => item.id === productId);
    patchLine(key, {
      productId,
      productName: product ? product.name : "",
      unitPrice: product ? String(product.sellingPrice) : "0"
    });
  }

  const validLines = lines.filter((line) => line.productName.trim() && Number(line.quantity) > 0);

  async function submitOffer() {
    if (!companyId || !title || !validLines.length) return;
    await createOffer({
      companyId,
      title,
      items: validLines.map((line) => {
        const quantity = Number(line.quantity) || 1;
        const unitPrice = Number(line.unitPrice) || 0;
        return {
          id: crypto.randomUUID(),
          productName: line.productName.trim(),
          description: "",
          quantity,
          unitPrice,
          totalPrice: quantity * unitPrice
        };
      })
    });
    setTitle("");
    setLines([emptyOfferLine()]);
  }

  return (
    <SimpleCreate
      icon={FileText}
      empty="No offers yet."
      list={data.offers.map((item) => ({
        id: item.id,
        title: item.offerNumber || item.title,
        subtitle: item.status,
        actions: (
          <>
            <button onClick={() => sendOffer(item.id)} className="text-xs font-semibold text-primary">Send</button>
            <button onClick={() => acceptOffer(item.id)} className="text-xs font-semibold text-success">Accept</button>
            <button onClick={() => convertOfferToInvoice(item.id)} className="text-xs font-semibold text-warning">Invoice</button>
            <button onClick={() => deleteOffer(item.id)} className="text-xs font-semibold text-danger">Delete</button>
          </>
        )
      }))}
      form={
        <>
          <Select label="Company" value={companyId} onChange={setCompanyId} options={data.companies.map((item) => [item.id, item.name] as [string, string])} />
          <Input label="Offer title" value={title} onChange={setTitle} />
          <div className="sm:col-span-2 space-y-3">
            <span className="text-sm text-muted dark:text-darkMuted">{t("offers.items")}</span>
            {lines.map((line) => (
              <div key={line.key} className="grid gap-2 rounded-2xl border border-[#E8DECF] bg-white p-3 dark:border-darkBorder dark:bg-[#202020] sm:grid-cols-[1fr_1fr_88px_110px_auto]">
                <select
                  value={line.productId}
                  onChange={(event) => selectProduct(line.key, event.target.value)}
                  aria-label={t("products.title")}
                  className="min-h-11 rounded-xl border border-[#E5D8C7] bg-white px-3 text-sm outline-none focus:border-primary/40 dark:border-darkBorder dark:bg-[#242424]"
                >
                  <option value="">{t("offers.freeTextItem")}</option>
                  {data.products.map((product) => (
                    <option key={product.id} value={product.id}>{product.name}</option>
                  ))}
                </select>
                <input
                  value={line.productName}
                  onChange={(event) => patchLine(line.key, { productName: event.target.value, productId: "" })}
                  placeholder={t("common.item")}
                  className="min-h-11 rounded-xl border border-[#E5D8C7] bg-white px-3 text-sm outline-none focus:border-primary/40 dark:border-darkBorder dark:bg-[#242424]"
                />
                <input
                  type="number"
                  min={1}
                  value={line.quantity}
                  onChange={(event) => patchLine(line.key, { quantity: event.target.value })}
                  aria-label={t("common.quantity")}
                  className="min-h-11 rounded-xl border border-[#E5D8C7] bg-white px-3 text-sm outline-none focus:border-primary/40 dark:border-darkBorder dark:bg-[#242424]"
                />
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={line.unitPrice}
                  onChange={(event) => patchLine(line.key, { unitPrice: event.target.value })}
                  aria-label={t("common.unitPrice")}
                  className="min-h-11 rounded-xl border border-[#E5D8C7] bg-white px-3 text-sm outline-none focus:border-primary/40 dark:border-darkBorder dark:bg-[#242424]"
                />
                <button
                  type="button"
                  onClick={() => setLines((current) => (current.length > 1 ? current.filter((item) => item.key !== line.key) : current))}
                  disabled={lines.length <= 1}
                  aria-label={t("actions.delete")}
                  className="inline-flex min-h-11 items-center justify-center rounded-xl border border-[#E5D8C7] bg-white px-3 text-danger transition hover:border-danger/40 disabled:opacity-40 dark:border-darkBorder dark:bg-[#242424]"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
            <Button variant="secondary" onClick={() => setLines((current) => [...current, emptyOfferLine()])}>
              {t("offers.addItem")}
            </Button>
          </div>
          <Button onClick={() => void submitOffer()} disabled={!companyId || !title || !validLines.length}>
            Create offer
          </Button>
        </>
      }
    />
  );
}

function InvoiceForm() {
  const { data, createInvoice, markInvoicePaid } = useAppState();
  const [companyId, setCompanyId] = useState("");
  const [productName, setProductName] = useState("");
  const [price, setPrice] = useState("0");
  return (
    <SimpleCreate
      icon={ReceiptText}
      empty="No invoices yet."
      list={data.invoices.map((item) => ({
        id: item.id,
        title: item.invoiceNumber,
        subtitle: item.status,
        actions: <button onClick={() => markInvoicePaid(item.id)} className="text-xs font-semibold text-success">Mark paid</button>
      }))}
      form={
        <>
          <Select label="Company" value={companyId} onChange={setCompanyId} options={data.companies.map((item) => [item.id, item.name] as [string, string])} />
          <Input label="Item" value={productName} onChange={setProductName} />
          <Input label="Price" value={price} onChange={setPrice} type="number" />
          <Button
            onClick={() =>
              createInvoice({
                companyId,
                items: [{ id: crypto.randomUUID(), productName, description: "", quantity: 1, unitPrice: Number(price), totalPrice: Number(price) }]
              }).then(() => setProductName(""))
            }
            disabled={!companyId || !productName}
          >
            Create invoice
          </Button>
        </>
      }
    />
  );
}

function DocumentForm() {
  const { data, createDocument } = useAppState();
  const [companyId, setCompanyId] = useState("");
  const [fileName, setFileName] = useState("");
  return (
    <SimpleCreate
      icon={Upload}
      empty="No documents yet."
      list={data.documents.map((item) => ({ id: item.id, title: item.fileName, subtitle: item.documentType }))}
      form={
        <>
          <Select label="Company" value={companyId} onChange={setCompanyId} options={[["", "No company"], ...data.companies.map((item) => [item.id, item.name] as [string, string])]} />
          <Input label="File name" value={fileName} onChange={setFileName} />
          <Button onClick={() => createDocument({ companyId: companyId || null, fileName, documentType: "PDF", fileType: "application/pdf", summary: "Manual document metadata" }).then(() => setFileName(""))} disabled={!fileName}>Create document</Button>
        </>
      }
    />
  );
}

function ModuleForm() {
  const { data, createModule } = useAppState();
  const [name, setName] = useState("");
  return (
    <SimpleCreate
      icon={Workflow}
      empty="No modules yet."
      list={data.modules.map((item) => ({ id: item.id, title: item.name, subtitle: item.type }))}
      form={
        <>
          <Input label="Module name" value={name} onChange={setName} />
          <Button onClick={() => createModule({ name, type: "custom", createdByAI: false }).then(() => setName(""))} disabled={!name}>Create module</Button>
        </>
      }
    />
  );
}

function SimpleCreate({
  form,
  list,
  empty,
  icon
}: {
  form: React.ReactNode;
  list: Array<{ id: string; title: string; subtitle?: string; actions?: React.ReactNode }>;
  empty: string;
  icon: LucideIcon;
}) {
  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
      <div className="grid gap-3 sm:grid-cols-2">{form}</div>
      <RecordList icon={icon} empty={empty} items={list} />
    </div>
  );
}

function RecordList({
  items,
  empty,
  icon: Icon
}: {
  items: Array<{ id: string; title: string; subtitle?: string; onEdit?: () => void; onDelete?: () => void; actions?: React.ReactNode }>;
  empty: string;
  icon: LucideIcon;
}) {
  if (!items.length) return <EmptyState title={empty} />;
  return (
    <div className="max-h-[420px] space-y-2 overflow-y-auto pe-1">
      {items.map((item) => (
        <div key={item.id} className="rounded-2xl border border-[#E8DECF] bg-white p-3 dark:border-darkBorder dark:bg-[#202020]">
          <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-beige text-primary dark:bg-[#2A2022] dark:text-darkPrimary">
              <Icon size={16} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-text dark:text-[#F5F0EA]">{item.title}</p>
              {item.subtitle ? <p className="truncate text-xs text-muted dark:text-darkMuted">{item.subtitle}</p> : null}
              <div className="mt-2 flex flex-wrap gap-2">
                {item.onEdit ? <button onClick={item.onEdit} className="text-xs font-semibold text-primary">Edit</button> : null}
                {item.onDelete ? <button onClick={item.onDelete} className="text-xs font-semibold text-danger">Delete</button> : null}
                {item.actions}
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function Input({
  label,
  value,
  onChange,
  type = "text",
  disabled = false
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  disabled?: boolean;
}) {
  return (
    <label className="block">
      <span className="text-sm text-muted dark:text-darkMuted">{label}</span>
      <input
        type={type}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className="mt-2 min-h-11 w-full rounded-xl border border-[#E5D8C7] bg-white px-3 text-sm outline-none focus:border-primary/40 disabled:cursor-not-allowed disabled:opacity-50 dark:border-darkBorder dark:bg-[#242424]"
      />
    </label>
  );
}

function Textarea({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="block sm:col-span-2">
      <span className="text-sm text-muted dark:text-darkMuted">{label}</span>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-2 min-h-24 w-full rounded-xl border border-[#E5D8C7] bg-white px-3 py-2 text-sm outline-none focus:border-primary/40 dark:border-darkBorder dark:bg-[#242424]"
      />
    </label>
  );
}

function Select({
  label,
  value,
  onChange,
  options
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<[string, string]>;
}) {
  return (
    <label className="block">
      <span className="text-sm text-muted dark:text-darkMuted">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-2 min-h-11 w-full rounded-xl border border-[#E5D8C7] bg-white px-3 text-sm outline-none focus:border-primary/40 dark:border-darkBorder dark:bg-[#242424]"
      >
        {options.map(([optionValue, label]) => (
          <option key={optionValue} value={optionValue}>
            {label}
          </option>
        ))}
      </select>
    </label>
  );
}
