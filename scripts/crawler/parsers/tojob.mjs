import { genericParse } from './_generic.mjs'
export async function parse(url) {
  return genericParse(url, {
    listSelector: '.list li, .board li, .item, article',
    titleSelector: '[class*="title"], h3, h4',
    linkSelector: 'a',
    typeSelector: '.type, [class*="type"]',
    deadlineSelector: '.date, [class*="day"]',
  })
}
