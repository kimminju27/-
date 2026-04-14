import { genericParse } from './_generic.mjs'
export async function parse(url) {
  return genericParse(url, {
    listSelector: '.campaign-wrap li, .list-wrap li, .item-box, .campaign-item',
    titleSelector: '[class*="title"], h3, .tit',
    linkSelector: 'a',
    typeSelector: '.type, .sns, [class*="type"]',
    applicantsSelector: '[class*="apply"], .apply-count',
    capacitySelector: '[class*="limit"], .max-count',
    deadlineSelector: '[class*="day"], .d-day',
  })
}
