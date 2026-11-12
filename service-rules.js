/* Chao service & delivery price rules: suggested service and transport fees. */
var ServiceRules = (() => {
    const BOX_SIZE = 15, BOX_PRICE = 5;
    const boxesFor = pieces => Math.ceil(Math.max(0, pieces) / BOX_SIZE);
    const usesBoxes = option => option === 'pickup' || option === 'boxes';

    // pickup: 5₾ per box · boxes: 25₾ delivery in Batumi + 5₾ per box
    // setup: delivery 2₾/person (min 25₾) + inventory & setup 5₾/person
    // full: full service 10₾/person + transport 2₾/person
    function fees(option, {guests = 0, boxes = 0}) {
        switch (option) {
            case 'pickup': return {serviceFee: boxes * BOX_PRICE, transportFee: 0};
            case 'boxes': return {serviceFee: boxes * BOX_PRICE, transportFee: 25};
            case 'setup': return {serviceFee: guests * 5, transportFee: Math.max(25, guests * 2)};
            case 'full': return {serviceFee: guests * 10, transportFee: guests * 2};
        }
    }

    return { boxesFor, usesBoxes, fees };
})();

if (typeof module !== 'undefined') module.exports = ServiceRules;
