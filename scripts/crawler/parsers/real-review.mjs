import { genericParse } from './_generic.mjs'
export async function parse(url) {
  return genericParse(url, {
    listSelector: '.list li, .campaign-list li, article, .item',
    titleSelector: 'h3, h4, [class*="title"], .tit',
    linkSelector: 'a',
    typeSelector: '[class*="type"], .channel',
    applicantsSelector: '[class*="apply"], [class*="count"]',
    capacitySelector: '[class*="limit"], [class*="total"]',
    deadlineSelector: '[class*="day"], [class*="date"]',
  })
}
