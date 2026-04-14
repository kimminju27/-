import { genericParse } from './_generic.mjs'
export async function parse(url) {
  return genericParse(url, {
    listSelector: '.campaign-list li, .list li, .item, .campaign-card, [class*="campaign"]',
    titleSelector: '[class*="title"], h3, h4',
    linkSelector: 'a',
    typeSelector: '[class*="type"], .channel',
    applicantsSelector: '[class*="apply"], [class*="count"]',
    capacitySelector: '[class*="limit"], [class*="total"]',
    deadlineSelector: '[class*="day"], [class*="date"]',
  })
}
