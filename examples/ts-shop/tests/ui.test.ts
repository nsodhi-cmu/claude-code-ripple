import { priceLabel } from '../src/ui'
import { assertEqual } from './assert'

assertEqual(priceLabel(12.5), 'Price: $12.50', 'priceLabel')
assertEqual(priceLabel(0), 'Price: $0.00', 'priceLabel zero')
