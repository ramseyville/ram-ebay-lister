// lib/doctor.test.ts — Listing Doctor pure helpers.

import { describe, it, expect } from "vitest";
import { compareSkus } from "@/lib/doctor-sku";
import { parseActiveListXml, parseItemXml } from "@/lib/ebay/trading";

describe("oldest-first SKU order", () => {
  it("sorts by bin then item number, unpatterned last", () => {
    const skus = ["2-1", "1-10", "312-20", "1-2", "MISC", "1-50", "10-1"];
    expect([...skus].sort(compareSkus)).toEqual(["1-2", "1-10", "1-50", "2-1", "10-1", "312-20", "MISC"]);
  });
});

describe("eBay Trading XML parsing", () => {
  it("reads the active list", () => {
    const xml =
      "<GetMyeBaySellingResponse><ActiveList><ItemArray>" +
      "<Item><ItemID>111</ItemID><SKU>1-2</SKU><Title>Polo &amp; Shirt</Title></Item>" +
      "<Item><ItemID>222</ItemID><SKU>1-1</SKU><Title>Jacket</Title></Item>" +
      "</ItemArray><PaginationResult><TotalNumberOfPages>1</TotalNumberOfPages></PaginationResult></ActiveList></GetMyeBaySellingResponse>";
    expect(parseActiveListXml(xml)).toEqual([
      { itemId: "111", sku: "1-2", title: "Polo & Shirt" },
      { itemId: "222", sku: "1-1", title: "Jacket" },
    ]);
  });

  it("reads one listing", () => {
    const xml =
      "<GetItemResponse><Ack>Success</Ack><Item>" +
      "<BestOfferDetails><BestOfferEnabled>false</BestOfferEnabled></BestOfferDetails>" +
      "<Description>&lt;p&gt;Nice &amp;amp; clean&lt;/p&gt;</Description>" +
      "<ItemID>298729704371</ItemID>" +
      "<ListingDetails><StartTime>2024-03-01T10:00:00.000Z</StartTime><ViewItemURL>https://www.ebay.com/itm/298729704371</ViewItemURL></ListingDetails>" +
      "<PrimaryCategory><CategoryID>63863</CategoryID><CategoryName>Clothing, Shoes &amp; Accessories:Women:Women&apos;s Clothing:Pants</CategoryName></PrimaryCategory>" +
      "<StartPrice currencyID=\"USD\">39.95</StartPrice>" +
      "<SKU>1-1</SKU><Title>Lauren Pants</Title>" +
      "<PictureDetails><PictureURL>https://i.ebayimg.com/a.jpg</PictureURL><PictureURL>https://i.ebayimg.com/b.jpg</PictureURL></PictureDetails>" +
      "<ItemSpecifics><NameValueList><Name>Brand</Name><Value>Lauren Ralph Lauren</Value></NameValueList>" +
      "<NameValueList><Name>Season</Name><Value>Spring</Value><Value>Summer</Value></NameValueList></ItemSpecifics>" +
      "<ConditionID>1000</ConditionID><ConditionDisplayName>New with tags</ConditionDisplayName>" +
      "<WatchCount>3</WatchCount>" +
      "</Item></GetItemResponse>";
    const it = parseItemXml(xml);
    expect(it.itemId).toBe("298729704371");
    expect(it.sku).toBe("1-1");
    expect(it.title).toBe("Lauren Pants");
    expect(it.description).toBe("<p>Nice &amp; clean</p>");
    expect(it.price).toBe(39.95);
    expect(it.conditionId).toBe(1000);
    expect(it.categoryId).toBe("63863");
    expect(it.categoryName).toBe("Clothing, Shoes & Accessories:Women:Women's Clothing:Pants");
    expect(it.specifics).toEqual({ Brand: ["Lauren Ralph Lauren"], Season: ["Spring", "Summer"] });
    expect(it.pictures).toEqual(["https://i.ebayimg.com/a.jpg", "https://i.ebayimg.com/b.jpg"]);
    expect(it.bestOfferEnabled).toBe(false);
    expect(it.watchCount).toBe(3);
    expect(it.url).toBe("https://www.ebay.com/itm/298729704371");
  });
});
