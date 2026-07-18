import { cookies } from "next/headers";

import { createClient } from "@/utils/supabase/server";

import {

  FINISHED_PRODUCT_SELECT,

  normalizeFinishedProduct,

  type FinishedProductRecord,

} from "../../inventory/finished-products-utils";

import { CLIENT_SELECT, type ClientEntry } from "../../operations/clients-utils";

import FinanceNav from "../finance-nav";

import ProductSales from "../product-sales";

import {

  normalizeProductSaleEntry,

  PRODUCT_SALES_SELECT,

  type ProductSaleEntry,

} from "../product-sales-utils";



export default async function ProductSalesPage() {

  const cookieStore = await cookies();

  const supabase = createClient(cookieStore);



  const [

    { data, error },

    { data: clients, error: clientsError },

    { data: finishedProducts, error: finishedProductsError },

  ] = await Promise.all([

    supabase

      .from("income_register")

      .select(PRODUCT_SALES_SELECT)

      .eq("entry_type", "product_sale")

      .order("date", { ascending: false }),

    supabase.from("customers").select(CLIENT_SELECT).order("client_name", { ascending: true }),

    supabase

      .from("finished_products")

      .select(FINISHED_PRODUCT_SELECT)

      .order("product_name", { ascending: true }),

  ]);



  const fetchError =

    error?.message ?? clientsError?.message ?? finishedProductsError?.message ?? null;



  return (

    <div>

      <h1 className="mb-6 text-2xl font-semibold text-[#0f2744]">Finance</h1>

      <FinanceNav />

      <h2 className="mb-6 text-xl font-semibold text-[#0f2744]">Product Sales</h2>

      <ProductSales

        initialEntries={

          ((data as ProductSaleEntry[] | null) ?? []).map((entry) =>

            normalizeProductSaleEntry(entry),

          )

        }

        initialClients={(clients as ClientEntry[] | null) ?? []}

        initialFinishedProducts={

          ((finishedProducts as FinishedProductRecord[] | null) ?? []).map(

            (product) => normalizeFinishedProduct(product),

          )

        }

        fetchError={fetchError}

      />

    </div>

  );

}

