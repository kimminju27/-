import { genericParse } from './_generic.mjs'
export async function parse(url) {
  return genericParse(url, {
    listSelector: '.campaign-list li, .list-item, [class*="campaign"] li, ul.campaigns > li, .item-box',
    titleSelector: '[class*="title"], h3, h4, .subject',
    linkSelector: 'a',
    typeSelector: '[class*="type"], .channel',
    applicantsSelector: '[class*="apply"], [class*="count"]',
    capacitySelector: '[class*="limit"], [class*="total"]',
    deadlineSelector: '[class*="day"], [class*="date"], .deadline',
  })
}
