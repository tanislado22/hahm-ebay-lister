import { describe, expect, it } from "vitest";
import type { StorePriceGuide } from "@/lib/markets/guatemala-price-match";
import {
  adviseSalePrice,
  chooseGarmentCost,
  estimatedProfitGtq,
  garmentCostInputForActor,
  listedPriceRange,
  minimumSaleQuetzales,
  monthlyExpenseShare,
  preparePricingSettings,
  presentSaleAdvice,
  saleAdviceGaps,
  priceIsBelowMinimum,
  recommendListedPrice,
  supportPhotoSuggestions,
} from "@/lib/markets/guatemala-sale-advice";

const settings = preparePricingSettings({
  monthlySalaryGtq: "1000",
  otherMonthlyExpensesGtq: "300",
  expectedMonthlySales: "100",
  minimumProfitGtq: "5",
});

function guide(partial: Partial<StorePriceGuide> & Pick<StorePriceGuide, "scope" | "garment" | "condition">): StorePriceGuide {
  return {
    brand: "",
    priceGtq: null,
    adjustmentGtq: null,
    comparableBrands: [],
    ...partial,
  };
}

describe("precio sugerido de Agregar artículo sin foto", () => {
  it("reparte los gastos mensuales y redondea el mínimo hacia arriba", () => {
    expect(settings.ok).toBe(true);
    if (!settings.ok) return;
    expect(monthlyExpenseShare(settings.settings)).toBe("10.00");
    expect(minimumSaleQuetzales("32.79", "13.00", "5.00")).toBe(51);
    expect(estimatedProfitGtq(60, "32.79", "13.00")).toBe("14.21");
  });

  it("sugiere el centro del rango cuando queda en o sobre el mínimo", () => {
    expect(recommendListedPrice({ low: 55, high: 65, minimum: 51 })).toBe(60);
    expect(recommendListedPrice({ low: 48, high: 70, minimum: 51 })).toBe(59);
    expect(recommendListedPrice({ low: 40, high: 50, minimum: 51 })).toBeNull();
  });

  it("usa el costo individual y, si falta, el promedio del lote", () => {
    expect(chooseGarmentCost({ individual: "32.79", lotAverage: "10.00" })).toEqual({
      source: "individual",
      costGtq: "32.79",
    });
    expect(chooseGarmentCost({ individual: "", lotAverage: "32.79" })).toEqual({
      source: "lot",
      costGtq: "32.79",
    });
    expect(chooseGarmentCost({ individual: "", lotAverage: null })).toEqual({
      source: "missing",
      costGtq: null,
    });
  });

  it("muestra el ejemplo del pantalón del lote 2", () => {
    expect(settings.ok).toBe(true);
    if (!settings.ok) return;
    const guides = [
      guide({ scope: "general", garment: "pantalon", condition: "usado", priceGtq: 60, lowGtq: 55, highGtq: 65 }),
    ];
    const advice = adviseSalePrice({
      itemType: "pantalon",
      brand: "",
      condition: "GOOD",
      individualCost: "",
      lotAverage: "32.79",
      settings: settings.settings,
      guides,
    });
    expect(advice).toMatchObject({
      status: "ready",
      costSource: "lot",
      costGtq: "32.79",
      expenseShareGtq: "10.00",
      minimumGtq: 48,
      recommendedGtq: 60,
      profitGtq: "17.21",
    });
    expect(priceIsBelowMinimum("47", advice.minimumGtq)).toBe(true);
    expect(priceIsBelowMinimum("48", advice.minimumGtq)).toBe(false);
  });

  it("avisa si no hay referencia o si el rango completo queda debajo del mínimo", () => {
    expect(settings.ok).toBe(true);
    if (!settings.ok) return;
    const shared = {
      itemType: "pantalon",
      condition: "GOOD",
      lotAverage: "32.79",
      settings: settings.settings,
    };
    const withoutGuide = adviseSalePrice({ ...shared, guides: [] });
    expect(withoutGuide.status).toBe("ready");
    expect(withoutGuide.minimumGtq).toBe(48);
    expect(withoutGuide.recommendedGtq).toBe(48);
    const low = [
      guide({ scope: "general", garment: "pantalon", condition: "usado", priceGtq: 45, lowGtq: 40, highGtq: 50 }),
    ];
    const review = adviseSalePrice({ ...shared, guides: low });
    expect(review.status).toBe("ready");
    expect(review.recommendedGtq).toBe(48);
    expect(review.minimumGtq).toBe(48);
  });

  it("suma el ajuste de marca al rango de la tabla", () => {
    const range = listedPriceRange(
      [
        guide({ scope: "general", garment: "pantalon", condition: "usado", priceGtq: 60, lowGtq: 55, highGtq: 65 }),
        guide({
          scope: "brand",
          garment: "pantalon",
          condition: "usado",
          brand: "Zara",
          adjustmentGtq: 10,
        }),
      ],
      { itemType: "pantalon", brand: "Zara", condition: "GOOD" }
    );
    expect(range).toEqual({ low: 65, high: 75 });
  });

  it("redondea el ejemplo del lote 1 a Q20 y no vuelve a sumar los gastos del lote", () => {
    const configured = preparePricingSettings({
      monthlySalaryGtq: "0",
      otherMonthlyExpensesGtq: "2000",
      expectedMonthlySales: "400",
      minimumProfitGtq: "8",
    });
    expect(configured.ok).toBe(true);
    if (!configured.ok) return;
    expect(monthlyExpenseShare({ ...configured.settings, monthlySalaryGtq: "2000.00" })).toBe("5.00");
    expect(minimumSaleQuetzales("6.14", "5.00", "8.00")).toBe(20);
    const guides = [
      guide({ scope: "general", garment: "pantalon", condition: "usado", priceGtq: 30, lowGtq: 30, highGtq: 30 }),
    ];
    const advice = adviseSalePrice({
      itemType: "pantalon",
      condition: "GOOD",
      lotAverage: "6.14",
      settings: { ...configured.settings, monthlySalaryGtq: "2000.00" },
      guides,
    });
    expect(advice.expenseShareGtq).toBe("5.00");
    expect(advice.minimumGtq).toBe(20);
    expect(advice.recommendedGtq).toBe(30);
    const staff = presentSaleAdvice(advice, "encargado");
    expect(staff).toEqual({ status: "ready", minimumGtq: 20, recommendedGtq: 30, notice: "" });
    expect(JSON.stringify(staff)).not.toContain("6.14");
    expect(JSON.stringify(staff)).not.toContain("cost");
    const owner = presentSaleAdvice(advice, "propietario");
    expect(owner.costGtq).toBe("6.14");
    expect(owner.costSource).toBe("lot");
    expect(presentSaleAdvice({ ...advice, status: "need-cost", minimumGtq: null, recommendedGtq: null, notice: "" }, "encargado").notice).toBe(
      "Todavía no se puede calcular el mínimo."
    );
    expect(saleAdviceGaps({})).toEqual(["Elige el tipo de artículo.", "Confirma el estado de la prenda."]);
    expect(garmentCostInputForActor("encargado", "6.14")).toBeUndefined();
    expect(garmentCostInputForActor("propietario", "6.14")).toBe("6.14");
    expect(preparePricingSettings({ ...configured.settings, expectedMonthlySales: "0" }).ok).toBe(false);
  });

  it("sugiere el precio de una playera y reserva el costo para el dueño", () => {
    expect(settings.ok).toBe(true);
    if (!settings.ok) return;
    const advice = adviseSalePrice({
      itemType: "playera",
      condition: "GOOD",
      lotAverage: "6.14",
      settings: settings.settings,
      guides: [guide({ scope: "general", garment: "camiseta", condition: "usado", priceGtq: 45, lowGtq: 45, highGtq: 45 })],
    });
    expect(advice.recommendedGtq).toBe(45);
    const staff = presentSaleAdvice(advice, "encargado");
    expect(staff).toEqual({ status: "ready", minimumGtq: 22, recommendedGtq: 45, notice: "" });
    expect(JSON.stringify(staff)).not.toContain("6.14");
    expect(JSON.stringify(staff)).not.toContain("cost");
  });

  it("suma Q5 del sueldo configurado y usa la regla general de camiseta para una playera", () => {
    const configured = preparePricingSettings({
      monthlySalaryGtq: "2000",
      otherMonthlyExpensesGtq: "2000",
      expectedMonthlySales: "400",
      minimumProfitGtq: "8",
    });
    expect(configured.ok).toBe(true);
    if (!configured.ok) return;
    expect(monthlyExpenseShare(configured.settings)).toBe("5.00");
    const advice = adviseSalePrice({
      itemType: "playera",
      brand: "Gildan",
      condition: "GOOD",
      lotAverage: "8.00",
      settings: configured.settings,
      guides: [guide({ scope: "general", garment: "camiseta", condition: "usado", priceGtq: 45, lowGtq: 45, highGtq: 45 })],
    });
    expect(advice.expenseShareGtq).toBe("5.00");
    expect(advice.minimumGtq).toBe(21);
    expect(advice.recommendedGtq).toBe(45);
    const withoutGuide = adviseSalePrice({
      itemType: "playera",
      condition: "GOOD",
      lotAverage: "8.00",
      settings: configured.settings,
      guides: [],
    });
    expect(withoutGuide.recommendedGtq).toBe(21);
    expect(withoutGuide.minimumGtq).toBe(21);
    const staff = presentSaleAdvice(advice, "encargado");
    expect(staff).toEqual({ status: "ready", minimumGtq: 21, recommendedGtq: 45, notice: "" });
    expect(JSON.stringify(staff)).not.toContain("2000");
    expect(JSON.stringify(staff)).not.toContain("5.00");
    expect(JSON.stringify(staff)).not.toContain("8.00");
    expect(JSON.stringify(staff)).not.toContain("cost");
    expect(JSON.stringify(staff)).not.toContain("salary");
    const owner = presentSaleAdvice(advice, "propietario");
    expect(owner.salaryGtq).toBe("2000.00");
    expect(owner.estimatedMonthlySales).toBe(400);
    const missing = adviseSalePrice({ itemType: "playera", condition: "GOOD", lotAverage: "8.00", settings: null });
    expect(missing.status).toBe("need-settings");
    expect(missing.notice).toBe("Configura el sueldo mensual del encargado y las prendas estimadas al mes en Configurar precios.");
    expect(presentSaleAdvice(missing, "encargado").notice).toBe("El dueño todavía no configuró los precios.");
  });

  it("deja escribir la marca y la talla cuando la etiqueta no se lee", () => {
    expect(
      supportPhotoSuggestions({ itemType: "Pantalón", brand: "sin etiqueta", size: "", condition: "usado" })
    ).toEqual({
      itemType: "pantalon",
      brand: "",
      size: "",
      condition: "GOOD",
      labelReadable: false,
    });
    expect(
      supportPhotoSuggestions({ itemType: "blusa", brand: "Zara", size: "M", condition: "nuevo" }).labelReadable
    ).toBe(true);
  });
});
