import mongoose from "mongoose";
import dotenv from "dotenv";

dotenv.config();

const orderSchema = new mongoose.Schema({}, { strict: false });
const Order = mongoose.model("Order", orderSchema);

const run = async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log("Connected to DB");

        const testCases = [
            { name: "Single digit '1'", search: "1" },
            { name: "Specific hex part '7ACC26E6'", search: "7ACC26E6" }
        ];

        for (const test of testCases) {
            console.log(`\n--- Testing: ${test.name} ---`);
            const searchTerm = test.search;
            const filter = {};

            if (searchTerm.match(/^[0-9a-fA-F]{24}$/)) {
                filter._id = searchTerm
            } else {
                filter.$expr = {
                    $regexMatch: {
                        input: { $toString: "$_id" },
                        regex: searchTerm,
                        options: "i",
                    },
                }
            }

            console.log("Constructed Filter:", JSON.stringify(filter, null, 2));

            const total = await Order.countDocuments(filter);
            console.log(`Matched Documents: ${total}`);

            if (total > 0 && total < 10) {
                 const docs = await Order.find(filter).select("_id");
                 console.log("Matched IDs:", docs.map(d => d._id.toString()));
            } else if (total === 0) {
                console.log("No matches found.");
            } else {
                console.log("Showing first 5 matches:");
                 const docs = await Order.find(filter).select("_id").limit(5);
                 console.log(docs.map(d => d._id.toString()));
            }
        }

        process.exit(0);

    } catch (error) {
        console.error("Error:", error);
        process.exit(1);
    }
};

run();
