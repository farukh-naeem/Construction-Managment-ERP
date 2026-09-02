import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useConsumableItems } from "@/hooks/useConsumableItems";
import { useVendors } from "@/hooks/useVendors";
import { createItemLedgerEntriesBulk } from "@/services/itemLedgerService";
import { createConsumableUnit, listConsumableUnits, type ApiConsumableUnit } from "@/services/consumableUnitService";
import { todayPKT } from "@/lib/pktDate";
import { toast } from "sonner";

type Method = "Cash" | "Bank" | "Online";
type Row = { vendorId: string; qty: string; unit: string; price: string; paid: string; bilty: string; vehicle: string; method: Method; reference: string; remarks: string };
const blank = (): Row => ({ vendorId:"",qty:"",unit:"",price:"",paid:"",bilty:"",vehicle:"",method:"Cash",reference:"",remarks:"" });

export function BulkAddLedgerEntryDialog({ open, onOpenChange, projectId, onSuccess }: { open:boolean; onOpenChange:(open:boolean)=>void; projectId:string|null; onSuccess:()=>void }) {
  const { items } = useConsumableItems(open ? projectId : null); const { vendors } = useVendors(open ? projectId : null);
  const [date,setDate]=useState(todayPKT()); const [rows,setRows]=useState<Record<string,Row>>({}); const [units,setUnits]=useState<ApiConsumableUnit[]>([]);
  const [allVendor,setAllVendor]=useState(""); const [allUnit,setAllUnit]=useState(""); const [allMethod,setAllMethod]=useState<Method>("Cash");
  const [newUnit,setNewUnit]=useState(""); const [errors,setErrors]=useState<Record<number,string>>({}); const [submitting,setSubmitting]=useState(false);
  useEffect(()=>{ if(open){ setRows(Object.fromEntries(items.map((i)=>[i.id,blank()]))); listConsumableUnits().then(setUnits).catch(()=>toast.error("Failed to load units")); } },[open,items]);
  const change=(id:string,key:keyof Row,value:string)=>setRows((c)=>({...c,[id]:{...(c[id]??blank()),[key]:value}}));
  const applyAll=(key:"vendorId"|"unit"|"method",value:string)=>setRows((c)=>Object.fromEntries(items.map((i)=>[i.id,{...(c[i.id]??blank()),[key]:value}])));
  const addUnit=async()=>{ if(!newUnit.trim()) return; try{const u=await createConsumableUnit({name:newUnit.trim()});setUnits((x)=>[...x,u].sort((a,b)=>a.name.localeCompare(b.name)));setAllUnit(u.name);applyAll("unit",u.name);setNewUnit("");}catch(e){toast.error(e instanceof Error?e.message:"Failed to add unit");}};
  const submit=async()=>{
    if(!projectId||!date)return toast.error("Project and date are required");
    const clientErrors:Record<number,string>={};
    items.forEach((item,index)=>{
      const r=rows[item.id]??blank(); const qty=Number(r.qty);
      if(qty>0){
        if(!r.vendorId)clientErrors[index]="Vendor is required";
        else if(!r.unit.trim())clientErrors[index]="Unit is required";
        else if(!Number.isFinite(Number(r.price))||Number(r.price)<0||r.price==="")clientErrors[index]="Unit price must be at least 0";
        else if(r.paid!==""&&(!Number.isFinite(Number(r.paid))||Number(r.paid)<0))clientErrors[index]="Paid amount must be at least 0";
      }
    });
    if(Object.keys(clientErrors).length){setErrors(clientErrors);toast.error(`Fix ${Object.keys(clientErrors).length} rows`);return;}
    const submittedIndexes:number[]=[];
    const entries=items.flatMap((item,index)=>{
      const r=rows[item.id]??blank();const qty=Number(r.qty);
      if(qty>0)submittedIndexes.push(index);
      return qty>0?[{itemId:item.id,vendorId:r.vendorId,date,quantity:qty,unit:r.unit,unitPrice:Number(r.price),paidAmount:Number(r.paid)||0,biltyNumber:r.bilty||undefined,vehicleNumber:r.vehicle||undefined,paymentMethod:r.method,referenceId:r.method!=="Cash"?r.reference||undefined:undefined,remarks:r.remarks||undefined}]:[];
    });
    if(!entries.length)return toast.error("Enter a quantity for at least one item");
    setSubmitting(true);setErrors({});
    try{const result=await createItemLedgerEntriesBulk({projectId,entries});toast.success(`${result.created} purchases added`);onSuccess();onOpenChange(false);}
    catch(err){const data=(err as Error&{data?:{rows?:{rowIndex:number;message:string}[]}}).data;if(data?.rows)setErrors(Object.fromEntries(data.rows.map((r)=>[submittedIndexes[r.rowIndex]??r.rowIndex,r.message])));toast.error(data?.rows?`Fix ${data.rows.length} rows`:err instanceof Error?err.message:"Bulk purchase failed");}
    finally{setSubmitting(false);}
  };
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-w-[98vw] max-h-[92vh] overflow-hidden flex flex-col"><DialogHeader><DialogTitle>Bulk Purchase</DialogTitle></DialogHeader>
    <div className="flex flex-wrap items-end gap-3"><div><Label>Date</Label><Input className="mt-1 w-40" type="date" value={date} onChange={(e)=>setDate(e.target.value)}/></div>
      <div><Label>Vendor for all</Label><Select value={allVendor} onValueChange={(v)=>{setAllVendor(v);applyAll("vendorId",v)}}><SelectTrigger className="w-44"><SelectValue placeholder="Optional"/></SelectTrigger><SelectContent>{vendors.map((v)=><SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}</SelectContent></Select></div>
      <div><Label>Unit for all</Label><Select value={allUnit} onValueChange={(v)=>{setAllUnit(v);applyAll("unit",v)}}><SelectTrigger className="w-36"><SelectValue placeholder="Optional"/></SelectTrigger><SelectContent>{units.map((u)=><SelectItem key={u.id} value={u.name}>{u.name}</SelectItem>)}</SelectContent></Select></div>
      <div className="flex gap-1"><Input className="w-28" placeholder="New unit" value={newUnit} onChange={(e)=>setNewUnit(e.target.value)}/><Button variant="outline" onClick={addUnit}>Add</Button></div>
      <div><Label>Method for all</Label><Select value={allMethod} onValueChange={(v:Method)=>{setAllMethod(v);applyAll("method",v)}}><SelectTrigger className="w-32"><SelectValue/></SelectTrigger><SelectContent>{["Cash","Bank","Online"].map((m)=><SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent></Select></div></div>
    <div className="overflow-auto border-2 border-border flex-1"><table className="min-w-[1750px] w-full text-sm"><thead className="sticky top-0 bg-primary text-primary-foreground"><tr>{["Item","Vendor","Qty","Unit","Unit Price","Total","Paid","Bilty","Vehicle","Method","Reference","Remarks"].map((h)=><th key={h} className="p-2 text-left">{h}</th>)}</tr></thead><tbody>
      {items.map((item,index)=>{const r=rows[item.id]??blank();return <tr key={item.id} className={`border-b ${errors[index]?"bg-destructive/10":""}`}><td className="p-2 font-semibold sticky left-0 bg-background min-w-44">{item.name}{errors[index]&&<div className="text-xs text-destructive">{errors[index]}</div>}</td>
        <td className="p-2 min-w-44"><Select value={r.vendorId} onValueChange={(v)=>change(item.id,"vendorId",v)}><SelectTrigger><SelectValue placeholder="Vendor"/></SelectTrigger><SelectContent>{vendors.map((v)=><SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}</SelectContent></Select></td>
        <td className="p-2"><Input type="number" min="0" step="any" value={r.qty} onChange={(e)=>change(item.id,"qty",e.target.value)}/></td><td className="p-2 min-w-32"><Select value={r.unit} onValueChange={(v)=>change(item.id,"unit",v)}><SelectTrigger><SelectValue placeholder="Unit"/></SelectTrigger><SelectContent>{units.map((u)=><SelectItem key={u.id} value={u.name}>{u.name}</SelectItem>)}</SelectContent></Select></td>
        <td className="p-2"><Input type="number" min="0" step="any" value={r.price} onChange={(e)=>change(item.id,"price",e.target.value)}/></td><td className="p-2 font-mono">{((Number(r.qty)||0)*(Number(r.price)||0)).toFixed(2)}</td><td className="p-2"><Input type="number" min="0" value={r.paid} onChange={(e)=>change(item.id,"paid",e.target.value)}/></td>
        {(["bilty","vehicle"] as const).map((k)=><td key={k} className="p-2"><Input value={r[k]} onChange={(e)=>change(item.id,k,e.target.value)}/></td>)}<td className="p-2 min-w-28"><Select value={r.method} onValueChange={(v:Method)=>change(item.id,"method",v)}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent>{["Cash","Bank","Online"].map((m)=><SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent></Select></td>
        <td className="p-2"><Input disabled={r.method==="Cash"} value={r.reference} onChange={(e)=>change(item.id,"reference",e.target.value)}/></td><td className="p-2"><Input value={r.remarks} onChange={(e)=>change(item.id,"remarks",e.target.value)}/></td></tr>})}</tbody></table></div>
    <DialogFooter><Button variant="outline" onClick={()=>onOpenChange(false)}>Cancel</Button><Button variant="warning" disabled={submitting} onClick={submit}>{submitting?"Saving…":"Save Purchases"}</Button></DialogFooter></DialogContent></Dialog>;
}
