import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {

  const { searchParams } = new URL(request.url);

  const q = searchParams.get("q");

  if (!q) {

    return NextResponse.json(

      {

        ok: false,

        error: "Escribe un artículo para buscar.",

        example: "/api/ebay/price-test?q=Levis+550+mens+jeans",

      },

      { status: 400 }

    );

  }

  try {

    /*

      PRIMERA PRUEBA DEL COMPARADOR DE PRECIOS.

      Esta ruta comprueba que el buscador recibe correctamente

      el nombre del artículo.

      Después conectaremos aquí la búsqueda de eBay para obtener:

      - artículos activos

      - artículos vendidos

      - precio promedio

      - precio mediano

      - sell-through rate

      - precio recomendado

    */

    return NextResponse.json({

      ok: true,

      search: q,

      message: "Price test route is working.",

      nextStep: "Connect eBay active and sold comparables.",

    });

  } catch (error) {

    console.error("[ebay/price-test]", error);

    return NextResponse.json(

      {

        ok: false,

        error: "Price test failed.",

      },

      { status: 500 }

    );

  }

}
